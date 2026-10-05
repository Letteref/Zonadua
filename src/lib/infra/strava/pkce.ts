/**
 * Strava OAuth PKCE — the verifier and challenge pair (ARCHITECTURE.md §6.1).
 *
 * ## Why PKCE for a client that has no secret
 *
 * The app is fully client-side. Strava's client secret can never be bundled, so the
 * authorization code is exchanged by a Worker that holds it. That alone would leave the
 * redirect vulnerable to an attacker who can read the callback URL: a stolen `code` would
 * be redeemable by anyone, because there is no client secret on the frontend to prove who
 * asked for it. PKCE closes exactly that hole — the verifier never leaves this device, and
 * a code lifted from the redirect is useless without it.
 *
 * ## Encoding, and why base64url
 *
 * RFC 7636 requires the verifier to be 43–128 characters from the unreserved set, and
 * Strava only accepts `S256`. base64url of 32 random bytes is exactly 43 characters and
 * needs no percent-encoding when it travels in a query string, so this file emits it
 * directly instead of hex (64 characters) or std base64 (`+` and `/` in a URL).
 *
 * Kept free of Dexie, fetch and localStorage so the code that guards the token exchange
 * can be tested without a browser, and so the challenge it produces can be asserted
 * against the RFC 7636 test vector.
 */

const VERIFIER_BYTES = 32; // 256 bits → 43 base64url chars, the RFC 7636 minimum
const STATE_BYTES = 16;

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/** base64url without padding (RFC 4648 §5). */
export function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh verifier, sent only to Strava and only inside the token exchange body. */
export function randomCodeVerifier(): string {
  return base64Url(randomBytes(VERIFIER_BYTES));
}

/**
 * The `state` value.
 *
 * Separate from the verifier on purpose: Strava echoes `state` back on the redirect and it
 * is the only thing that proves the callback belongs to an authorization *this* device
 * started. Neither value is a secret in the browser, but both must be unpredictable, so
 * they come from the same CSPRNG.
 */
export function randomState(): string {
  return base64Url(randomBytes(STATE_BYTES));
}

/** `BASE64URL(SHA-256(ASCII(verifier)))` — the RFC 7636 §4.2 transformation. */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}
