/**
 * Strava OAuth endpoints — the URL the rider is sent to, and the parser for what Strava
 * sends back (ARCHITECTURE.md §6.1).
 *
 * ## What this file deliberately does not do
 *
 * It never builds the request that carries `client_secret`. The code → token exchange
 * posts to a Worker route (`/api/strava/token`); the Worker adds the secret and forwards
 * to `https://www.strava.com/oauth/token`. `tokenExchangeBody` and `refreshBody` exist to
 * define that **wire contract** so the Worker and the frontend cannot drift, but nothing
 * here can leak the secret because nothing here knows it.
 *
 * ## Failure posture
 *
 * Strava answers a denied authorization with `?error=access_denied` and can answer the
 * token call with an error object instead of a token. Both are normal outcomes of a user
 * pressing "Cancel", not bugs, so the parsers return `null` (or an explicit error) and the
 * caller reports it in words rather than throwing.
 */

export const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';

/**
 * The only scope the app asks for.
 *
 * `activity:read_all` includes private activities; it does not include `activity:write`,
 * because Zonadua never uploads, edits or deletes anything in the rider's Strava account.
 * Asking for a scope the app cannot use is a consent screen that lies about what is wanted.
 */
export const STRAVA_SCOPE = 'activity:read_all';

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

/** The URL to send the rider to. Exported so its shape can be asserted without a network. */
export function authorizeUrl(p: AuthorizeParams): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    // `auto` reuses an existing grant instead of forcing the consent screen every sync
    approval_prompt: 'auto',
    scope: STRAVA_SCOPE,
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256'
  });
  return `${STRAVA_AUTHORIZE_URL}?${q.toString()}`;
}

/** Form body the Worker posts to Strava's token endpoint (the secret is added there). */
export function tokenExchangeBody(p: {
  clientId: string;
  code: string;
  codeVerifier: string;
}): Record<string, string> {
  return {
    client_id: p.clientId,
    code: p.code,
    code_verifier: p.codeVerifier,
    grant_type: 'authorization_code'
  };
}

/** Form body for refreshing an expired access token. */
export function refreshBody(p: { clientId: string; refreshToken: string }): Record<string, string> {
  return { client_id: p.clientId, refresh_token: p.refreshToken, grant_type: 'refresh_token' };
}

export interface TokenResponse {
  accessToken: string;
  /**
   * Strava omits `refresh_token` on a *refresh* response (the same one stays valid); the
   * caller must then keep the token it already had rather than overwriting it with nothing.
   */
  refreshToken: string | null;
  /** epoch seconds, Strava's own `expires_at` */
  expiresAt: number;
  athleteId?: number;
}

/**
 * Parse Strava's token payload.
 *
 * Returns `null` rather than a partially-filled object when `access_token` or `expires_at`
 * is missing. A half-parsed token is the dangerous case: it would be stored, look connected,
 * and fail every subsequent request with no explanation.
 */
export function parseTokenResponse(body: unknown): TokenResponse | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;

  const accessToken = typeof b.access_token === 'string' ? b.access_token : null;
  const expiresAt = typeof b.expires_at === 'number' ? b.expires_at : null;
  if (!accessToken || expiresAt === null) return null;

  const refreshToken = typeof b.refresh_token === 'string' && b.refresh_token ? b.refresh_token : null;
  const athlete = b.athlete && typeof b.athlete === 'object' ? (b.athlete as Record<string, unknown>) : null;
  const athleteId = athlete && typeof athlete.id === 'number' ? athlete.id : undefined;

  return { accessToken, refreshToken, expiresAt, athleteId };
}

/**
 * Read the redirect's query string.
 *
 * Returns the pair the app must verify (`code` + `state`), the `error` Strava reports when
 * the rider declines, or `null` when neither is present — which means the deep link was not
 * a Strava callback at all. The caller checks `state` against the one it generated; a
 * mismatched state must abort before the code is exchanged.
 */
export function readCallback(
  search: string
): { code: string; state: string } | { error: string } | null {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

  const error = q.get('error');
  if (error) return { error };

  const code = q.get('code');
  if (!code) return null;
  // Strava always echoes state alongside the code; an absent one is treated as an
  // empty string so the mismatch check still fires instead of being skipped.
  return { code, state: q.get('state') ?? '' };
}
