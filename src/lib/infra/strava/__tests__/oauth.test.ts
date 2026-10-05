import { describe, it, expect } from 'vitest';
import {
  STRAVA_AUTHORIZE_URL,
  STRAVA_SCOPE,
  authorizeUrl,
  parseTokenResponse,
  readCallback,
  refreshBody,
  tokenExchangeBody
} from '../oauth';

describe('strava oauth', () => {
  describe('authorizeUrl', () => {
    const url = new URL(
      authorizeUrl({
        clientId: '12345',
        redirectUri: 'https://zonadua.pages.dev/oauth/strava',
        state: 'st-ate',
        codeChallenge: 'ch-allenge'
      })
    );

    it('targets Strava and asks for an authorization code', () => {
      expect(url.origin + url.pathname).toBe(STRAVA_AUTHORIZE_URL);
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('12345');
    });

    it('asks for read-all and nothing more', () => {
      expect(url.searchParams.get('scope')).toBe(STRAVA_SCOPE);
      expect(url.searchParams.get('scope')).toBe('activity:read_all');
      expect(url.searchParams.get('scope')).not.toContain('write');
    });

    it('carries the PKCE challenge and the state verbatim', () => {
      expect(url.searchParams.get('code_challenge')).toBe('ch-allenge');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('state')).toBe('st-ate');
    });

    it('encodes the redirect URI rather than emitting it raw', () => {
      expect(url.searchParams.get('redirect_uri')).toBe('https://zonadua.pages.dev/oauth/strava');
      expect(authorizeUrl({ clientId: '1', redirectUri: 'https://a/b c', state: 's', codeChallenge: 'c' })).toContain(
        'redirect_uri=https%3A%2F%2Fa%2Fb+c'
      );
    });
  });

  describe('token exchange bodies', () => {
    it('never carries a client secret — the Worker adds it', () => {
      const body = tokenExchangeBody({ clientId: '9', code: 'c0de', codeVerifier: 'v' });
      expect(body).toEqual({
        client_id: '9',
        code: 'c0de',
        code_verifier: 'v',
        grant_type: 'authorization_code'
      });
      expect(JSON.stringify(body)).not.toContain('secret');
    });

    it('refreshes with the refresh grant', () => {
      expect(refreshBody({ clientId: '9', refreshToken: 'r3f' })).toEqual({
        client_id: '9',
        refresh_token: 'r3f',
        grant_type: 'refresh_token'
      });
    });
  });

  describe('parseTokenResponse', () => {
    it('maps a Strava token payload', () => {
      expect(
        parseTokenResponse({
          access_token: 'a',
          refresh_token: 'r',
          expires_at: 1_700_000_000,
          athlete: { id: 77 }
        })
      ).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 1_700_000_000, athleteId: 77 });
    });

    it('keeps a refresh response from erasing the stored refresh token', () => {
      const t = parseTokenResponse({ access_token: 'a2', expires_at: 1 });
      expect(t).not.toBeNull();
      expect(t!.refreshToken).toBeNull();
    });

    it('refuses a half-parsed token instead of storing one', () => {
      expect(parseTokenResponse({ access_token: 'a' })).toBeNull();
      expect(parseTokenResponse({ expires_at: 1 })).toBeNull();
      expect(parseTokenResponse({ access_token: '', expires_at: 1 })).toBeNull();
      expect(parseTokenResponse(null)).toBeNull();
      expect(parseTokenResponse('nope')).toBeNull();
    });
  });

  describe('readCallback', () => {
    it('reads the code and state from the redirect', () => {
      expect(readCallback('?state=s1&code=c1&scope=read')).toEqual({ code: 'c1', state: 's1' });
      expect(readCallback('state=s1&code=c1')).toEqual({ code: 'c1', state: 's1' });
    });

    it('reports a declined authorization as an error, not as a code', () => {
      expect(readCallback('?error=access_denied')).toEqual({ error: 'access_denied' });
    });

    it('treats a missing state as an empty string so the mismatch check still fires', () => {
      expect(readCallback('?code=c1')).toEqual({ code: 'c1', state: '' });
    });

    it('returns null when the deep link is not a callback at all', () => {
      expect(readCallback('')).toBeNull();
      expect(readCallback('?foo=bar')).toBeNull();
    });
  });
});
