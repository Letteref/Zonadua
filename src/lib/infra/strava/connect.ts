/**
 * Strava connect — the rider-visible half of the OAuth flow (ARCHITECTURE.md §6.1,
 * STRAVA-SETUP.md steps 1–2).
 *
 * ## What this module owns
 *
 * `startStravaConnect` is what the Connect button calls: it generates the PKCE pair and the
 * `state`, parks them in `sessionStorage` (the tab navigates away to Strava and comes back,
 * so nothing in memory survives the round trip), and redirects to the authorize URL.
 *
 * `handleStravaCallback` runs once per boot. A Strava redirect lands on `/` with its `code`
 * *before* the hash, so the hash router never sees it — this is the only place that reads
 * it. It verifies `state` against the stored one **before** spending the code, exchanges the
 * code through the Pages Function (`/api/strava/token` — the secret lives there, never
 * here), and writes the parsed token into `sync_state`.
 *
 * ## What it deliberately does not do
 *
 * No ride pulling: the sync loop is a separate step and stays out of this file. The cursor
 * and `lastSyncAt` are treated as ride-log state, not credentials — a reconnect or a
 * disconnect keeps them so a future sync resumes where the log actually is.
 *
 * Browser seams (`sessionStorage`, `history`, navigation, Dexie) are injectable so every
 * branch — including the ones that must *not* hit the network — is testable without a
 * browser and without a Strava.
 */

import { db, type SyncState } from '$lib/data/db';
import { authorizeUrl, parseTokenResponse, readCallback, tokenExchangeBody, type TokenResponse } from './oauth';
import { codeChallengeS256, randomCodeVerifier, randomState } from './pkce';

/** `sessionStorage` key for the in-flight OAuth round trip. */
export const OAUTH_SESSION_KEY = 'strava_oauth';

interface StoredOAuth {
  verifier: string;
  state: string;
  redirectUri: string;
}

/** The client id comes from the build (it is public by design — see .env.example). */
function defaultClientId(): string | undefined {
  const id = import.meta.env.VITE_STRAVA_CLIENT_ID;
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
}

export interface ConnectDeps {
  clientId: string | undefined;
  origin: string;
  navigate: (url: string) => void;
  load: () => Promise<SyncState | undefined>;
  save: (row: SyncState) => Promise<unknown>;
}

export function defaultDeps(): ConnectDeps {
  return {
    clientId: defaultClientId(),
    origin: window.location.origin,
    navigate: (url) => window.location.assign(url),
    load: () => db.sync_state.get('strava'),
    save: (row) => db.sync_state.put(row)
  };
}

export type ConnectOutcome = { ok: true } | { ok: false; reason: 'not_configured' };

/**
 * Begin the connect flow. Returns `not_configured` when the deployment was built without
 * `VITE_STRAVA_CLIENT_ID` — an honest refusal instead of a redirect to a broken page.
 */
export async function startStravaConnect(deps: ConnectDeps = defaultDeps()): Promise<ConnectOutcome> {
  if (!deps.clientId) return { ok: false, reason: 'not_configured' };

  const verifier = randomCodeVerifier();
  const state = randomState();
  const redirectUri = `${deps.origin}/`;
  const codeChallenge = await codeChallengeS256(verifier);

  sessionStorage.setItem(OAUTH_SESSION_KEY, JSON.stringify({ verifier, state, redirectUri } satisfies StoredOAuth));
  deps.navigate(authorizeUrl({ clientId: deps.clientId, redirectUri, state, codeChallenge }));
  return { ok: true };
}

/**
 * Merge a parsed token response into the stored `sync_state` row.
 *
 * Pure so the refresh-token edge — Strava *omits* `refresh_token` on a refresh response,
 * and overwriting the stored one with nothing would brick the connection — is testable
 * without a database.
 */
export function mergeTokenRow(existing: SyncState | undefined, parsed: TokenResponse, now: number): SyncState {
  return {
    id: 'strava',
    // ride-log state, not credentials: a reconnect must not lose the sync position
    lastSyncAt: existing?.lastSyncAt,
    cursor: existing?.cursor,
    rateWindow: existing?.rateWindow,
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken ?? existing?.refreshToken,
    expiresAt: parsed.expiresAt,
    athleteId: parsed.athleteId ?? existing?.athleteId,
    updatedAt: now
  };
}

export type CallbackResult =
  | { handled: false }
  | { handled: true; status: 'denied'; error: string }
  | { handled: true; status: 'expired' }
  | { handled: true; status: 'state_mismatch' }
  | { handled: true; status: 'exchange_failed'; detail?: string }
  | { handled: true; status: 'connected'; athleteId?: number };

function readStored(): StoredOAuth | null {
  const raw = sessionStorage.getItem(OAUTH_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredOAuth>;
    if (typeof parsed.verifier !== 'string' || typeof parsed.state !== 'string') return null;
    return { verifier: parsed.verifier, state: parsed.state, redirectUri: parsed.redirectUri ?? '' };
  } catch {
    return null;
  }
}

/** The one-time code must not linger in the address bar or history after it was handled. */
function cleanCallbackUrl(): void {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
}

/**
 * Handle a Strava redirect, if this boot is one.
 *
 * Every handled outcome is a plain result — a declined consent or a failed exchange is the
 * rider pressing Cancel or a tired network, not a bug to throw over. On every handled path
 * the parked session is dropped, and the query string is scrubbed from the URL so a refresh
 * cannot replay the code.
 */
export async function handleStravaCallback(search: string, deps: ConnectDeps = defaultDeps()): Promise<CallbackResult> {
  const cb = readCallback(search);
  if (!cb) return { handled: false };

  const stored = readStored();
  sessionStorage.removeItem(OAUTH_SESSION_KEY);

  if ('error' in cb) {
    cleanCallbackUrl();
    return { handled: true, status: 'denied', error: cb.error };
  }
  // Without the parked verifier the code cannot be exchanged — say so, don't half-try.
  if (!stored) {
    cleanCallbackUrl();
    return { handled: true, status: 'expired' };
  }
  if (cb.state !== stored.state) {
    cleanCallbackUrl();
    return { handled: true, status: 'state_mismatch' };
  }

  let res: Response;
  try {
    res = await fetch('/api/strava/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(tokenExchangeBody({ clientId: deps.clientId ?? '', code: cb.code, codeVerifier: stored.verifier }))
    });
  } catch (err) {
    cleanCallbackUrl();
    return { handled: true, status: 'exchange_failed', detail: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) {
    // pass the upstream words through — the Function already forwards Strava's own body
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: unknown; error?: unknown };
      const msg = typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : null;
      if (msg) detail = msg;
    } catch {
      /* a body that is not JSON still leaves the status line */
    }
    cleanCallbackUrl();
    return { handled: true, status: 'exchange_failed', detail };
  }

  const parsed = parseTokenResponse(await res.json());
  if (!parsed) {
    cleanCallbackUrl();
    return { handled: true, status: 'exchange_failed', detail: 'unparseable token response' };
  }

  const existing = await deps.load();
  await deps.save(mergeTokenRow(existing, parsed, Date.now()));
  cleanCallbackUrl();
  return { handled: true, status: 'connected', athleteId: parsed.athleteId };
}

/**
 * Forget the credentials but keep the ride log's position: after reconnecting, a sync
 * resumes from the cursor instead of re-pulling history the device already has.
 */
export async function disconnectStrava(deps: ConnectDeps = defaultDeps()): Promise<void> {
  const existing = await deps.load();
  if (!existing) return;
  await deps.save({
    id: 'strava',
    lastSyncAt: existing.lastSyncAt,
    cursor: existing.cursor,
    rateWindow: existing.rateWindow,
    updatedAt: Date.now()
  });
}
