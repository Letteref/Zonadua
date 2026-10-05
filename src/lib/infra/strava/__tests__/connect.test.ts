import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OAUTH_SESSION_KEY,
  disconnectStrava,
  handleStravaCallback,
  mergeTokenRow,
  startStravaConnect,
  type ConnectDeps
} from '../connect';
import { codeChallengeS256 } from '../pkce';
import type { SyncState } from '$lib/data/db';

/**
 * What these guard: the OAuth round trip that ends with a Strava token stored on this
 * device. The dangerous branches are the quiet ones — a mismatched `state` that still
 * exchanges the code, a half-parsed token that gets stored and looks connected, a
 * disconnect that loses the sync cursor. Every browser seam is injected, so the branches
 * that must *not* hit the network are asserted with a fetch that fails the test if called.
 */

const CLIENT_ID = '12345';
const ORIGIN = 'https://zonadua.pages.dev';

function makeDeps(over: Partial<ConnectDeps> = {}): ConnectDeps & {
  navigated: string[];
  saved: SyncState[];
} {
  const navigated: string[] = [];
  const saved: SyncState[] = [];
  return {
    clientId: CLIENT_ID,
    origin: ORIGIN,
    navigate: (url) => navigated.push(url),
    load: async () => undefined,
    save: async (row) => {
      saved.push(row);
    },
    ...over,
    navigated,
    saved
  };
}

const TOKEN_BODY = {
  access_token: 'at-1',
  refresh_token: 'rt-1',
  expires_at: 1_800_000_000,
  token_type: 'Bearer',
  athlete: { id: 42 }
};

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('startStravaConnect', () => {
  it('refuses honestly when the deployment has no client id', async () => {
    const deps = makeDeps({ clientId: undefined });
    await expect(startStravaConnect(deps)).resolves.toEqual({ ok: false, reason: 'not_configured' });
    expect(deps.navigated).toEqual([]);
    expect(sessionStorage.getItem(OAUTH_SESSION_KEY)).toBeNull();
  });

  it('parks the PKCE pair and redirects to the authorize URL', async () => {
    const deps = makeDeps();
    await startStravaConnect(deps);

    expect(deps.navigated).toHaveLength(1);
    const url = new URL(deps.navigated[0]);
    expect(url.origin + url.pathname).toBe('https://www.strava.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('activity:read_all');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');

    const stored = JSON.parse(sessionStorage.getItem(OAUTH_SESSION_KEY)!);
    expect(stored.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored.state).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // the challenge in the URL is the S256 of the parked verifier
    expect(url.searchParams.get('state')).toBe(stored.state);
    await expect(codeChallengeS256(stored.verifier)).resolves.toBe(url.searchParams.get('code_challenge'));
  });
});

describe('mergeTokenRow', () => {
  it('writes a fresh row from a parsed token', () => {
    const row = mergeTokenRow(undefined, { accessToken: 'a', refreshToken: 'r', expiresAt: 5, athleteId: 7 }, 100);
    expect(row).toEqual({ id: 'strava', accessToken: 'a', refreshToken: 'r', expiresAt: 5, athleteId: 7, updatedAt: 100 });
  });

  it('keeps the stored refresh token when Strava omits it', () => {
    const existing = { id: 'strava', refreshToken: 'keep-me', updatedAt: 1 } as SyncState;
    const row = mergeTokenRow(existing, { accessToken: 'a2', refreshToken: null, expiresAt: 6 }, 200);
    expect(row.refreshToken).toBe('keep-me');
    expect(row.accessToken).toBe('a2');
  });

  it('keeps the ride-log position across a reconnect', () => {
    const existing = { id: 'strava', lastSyncAt: 9, cursor: 99, rateWindow: '15min', updatedAt: 1 } as SyncState;
    const row = mergeTokenRow(existing, { accessToken: 'a', refreshToken: 'r', expiresAt: 5, athleteId: 7 }, 300);
    expect(row.lastSyncAt).toBe(9);
    expect(row.cursor).toBe(99);
    expect(row.rateWindow).toBe('15min');
  });
});

describe('handleStravaCallback', () => {
  it('ignores a query string that is not a Strava callback', async () => {
    const deps = makeDeps();
    await expect(handleStravaCallback('?r=1730000000000', deps)).resolves.toEqual({ handled: false });
    expect(deps.saved).toEqual([]);
  });

  it('reports a declined authorization without touching the network', async () => {
    const fetchFn = stubFetch(200, TOKEN_BODY);
    const deps = makeDeps();
    const out = await handleStravaCallback('?error=access_denied', deps);

    expect(out).toEqual({ handled: true, status: 'denied', error: 'access_denied' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(OAUTH_SESSION_KEY)).toBeNull();
  });

  it('reports an expired session when no verifier was parked', async () => {
    const fetchFn = stubFetch(200, TOKEN_BODY);
    const deps = makeDeps();
    const out = await handleStravaCallback('?code=c&state=s', deps);

    expect(out).toEqual({ handled: true, status: 'expired' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(deps.saved).toEqual([]);
  });

  it('aborts on a state mismatch before spending the code', async () => {
    const fetchFn = stubFetch(200, TOKEN_BODY);
    sessionStorage.setItem(OAUTH_SESSION_KEY, JSON.stringify({ verifier: 'v'.repeat(43), state: 'real', redirectUri: `${ORIGIN}/` }));
    const deps = makeDeps();
    const out = await handleStravaCallback('?code=c&state=forged', deps);

    expect(out).toEqual({ handled: true, status: 'state_mismatch' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(deps.saved).toEqual([]);
    expect(sessionStorage.getItem(OAUTH_SESSION_KEY)).toBeNull();
  });

  it('exchanges the code and stores the merged token row', async () => {
    const fetchFn = stubFetch(200, TOKEN_BODY);
    sessionStorage.setItem(OAUTH_SESSION_KEY, JSON.stringify({ verifier: 'v'.repeat(43), state: 'real', redirectUri: `${ORIGIN}/` }));
    const deps = makeDeps();
    const replaceState = vi.spyOn(window.history, 'replaceState');

    const out = await handleStravaCallback(`?code=the-code&state=real`, deps);

    expect(out).toEqual({ handled: true, status: 'connected', athleteId: 42 });
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/strava/token',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"code":"the-code"')
      })
    );
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.code_verifier).toBe('v'.repeat(43));
    expect(body.grant_type).toBe('authorization_code');
    expect(deps.saved[0]).toMatchObject({ id: 'strava', accessToken: 'at-1', refreshToken: 'rt-1', athleteId: 42 });
    expect(sessionStorage.getItem(OAUTH_SESSION_KEY)).toBeNull();
    expect(replaceState).toHaveBeenCalled();
  });

  it('forwards the upstream error words on a failed exchange', async () => {
    stubFetch(400, { message: 'Bad Request', errors: [{ resource: 'AuthorizationCode', field: 'code', code: 'invalid' }] });
    sessionStorage.setItem(OAUTH_SESSION_KEY, JSON.stringify({ verifier: 'v'.repeat(43), state: 'real', redirectUri: `${ORIGIN}/` }));
    const deps = makeDeps();

    const out = await handleStravaCallback('?code=stale&state=real', deps);

    expect(out).toEqual({ handled: true, status: 'exchange_failed', detail: 'Bad Request' });
    expect(deps.saved).toEqual([]);
  });

  it('refuses to store a half-parsed token payload', async () => {
    // no access_token: storing it would look connected and fail every later request
    stubFetch(200, { expires_at: 1_800_000_000 });
    sessionStorage.setItem(OAUTH_SESSION_KEY, JSON.stringify({ verifier: 'v'.repeat(43), state: 'real', redirectUri: `${ORIGIN}/` }));
    const deps = makeDeps();

    const out = await handleStravaCallback('?code=c&state=real', deps);

    expect(out).toEqual({ handled: true, status: 'exchange_failed', detail: 'unparseable token response' });
    expect(deps.saved).toEqual([]);
  });
});

describe('disconnectStrava', () => {
  it('drops the credentials but keeps the ride-log position', async () => {
    const deps = makeDeps({
      load: async () =>
        ({
          id: 'strava',
          lastSyncAt: 9,
          cursor: 99,
          accessToken: 'a',
          refreshToken: 'r',
          expiresAt: 5,
          athleteId: 7,
          updatedAt: 1
        }) as SyncState
    });

    await disconnectStrava(deps);

    expect(deps.saved[0]).toEqual({ id: 'strava', lastSyncAt: 9, cursor: 99, updatedAt: expect.any(Number) });
  });

  it('does nothing when nothing was connected', async () => {
    const deps = makeDeps();
    await disconnectStrava(deps);
    expect(deps.saved).toEqual([]);
  });
});
