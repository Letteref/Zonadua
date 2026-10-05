/**
 * Strava code ↔ token exchange — Cloudflare Pages Function.
 *
 * ## Why this exists at all
 *
 * The app is entirely client-side, so Strava's `client_secret` can never be bundled: anything
 * shipped to the browser is public. This Function is the only place the secret lives, and the
 * only thing it does is add it to a request the browser could not make on its own. Cloudflare
 * Pages deploys everything under `functions/` automatically, so this is the whole backend —
 * no separate Worker project, no wrangler dependency in `package.json`.
 *
 * Route: `POST /api/strava/token` (see docs/ARCHITECTURE.md §6.1).
 *
 * ## What it refuses to do
 *
 * It never forwards a `client_secret` sent by the client — this device's own env vars always
 * win — and it answers `bad_request` rather than guessing a grant. It never logs the secret,
 * and it passes Strava's response body through untouched so the frontend parser sees exactly
 * what Strava said instead of this layer's idea of it.
 *
 * ## Environment
 *
 * `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` must be set on the Pages project (Production
 * and Preview). Until they are, the route answers `503 strava_not_configured`, which is a
 * useful signal in itself: it proves the Function is deployed and reading its environment.
 *
 * Setup steps: docs/STRAVA-SETUP.md.
 */

const TOKEN_URL = 'https://www.strava.com/oauth/token';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}

export async function onRequestPost({ request, env }) {
  const clientId = env.STRAVA_CLIENT_ID;
  const clientSecret = env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return json({ error: 'strava_not_configured' }, 503);

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!input || typeof input !== 'object') return json({ error: 'bad_request' }, 400);

  const params = new URLSearchParams();
  if (typeof input.refreshToken === 'string' && input.refreshToken) {
    // a refresh keeps the same refresh token, so nothing else is needed
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', input.refreshToken);
  } else if (typeof input.code === 'string' && input.code) {
    params.set('grant_type', 'authorization_code');
    params.set('code', input.code);
    if (typeof input.codeVerifier === 'string' && input.codeVerifier) {
      params.set('code_verifier', input.codeVerifier);
    }
  } else {
    return json({ error: 'bad_request' }, 400);
  }

  // server-side credentials are authoritative: a client-supplied secret is ignored, not forwarded
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);

  let upstream;
  try {
    upstream = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params
    });
  } catch {
    return json({ error: 'upstream_unreachable' }, 502);
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}

export async function onRequestGet() {
  return json({ error: 'method_not_allowed' }, 405);
}
