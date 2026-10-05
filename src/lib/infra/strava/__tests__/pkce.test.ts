import { describe, it, expect } from 'vitest';
import { base64Url, codeChallengeS256, randomCodeVerifier, randomState } from '../pkce';

/**
 * The challenge is the only part of the flow an attacker can see, so its exact bytes matter:
 * if this produced hex or padded base64, Strava would reject the exchange, and if it produced
 * the verifier again there would be no PKCE at all. The RFC 7636 Appendix B vector is the one
 * fixed point that proves the transformation is the specified one and not merely "some hash".
 */
describe('strava pkce', () => {
  it('produces a verifier inside the RFC 7636 length and character set', () => {
    const v = randomCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('does not repeat a verifier or a state across calls', () => {
    expect(randomCodeVerifier()).not.toBe(randomCodeVerifier());
    expect(randomState()).not.toBe(randomState());
    // the two must not be the same value: state proves the callback, the verifier proves PKCE
    expect(randomState().length).toBeLessThan(randomCodeVerifier().length);
  });

  it('base64url strips padding and avoids URL-unsafe characters', () => {
    // 0xFF 0xFF 0xFF -> "////" in std base64, "_" in base64url
    expect(base64Url(new Uint8Array([0xff, 0xff, 0xff]))).toBe('____');
    expect(base64Url(new Uint8Array([0xff]))).toBe('_w');
    expect(base64Url(new Uint8Array([]))).toBe('');
  });

  it('matches the RFC 7636 Appendix B S256 test vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    await expect(codeChallengeS256(verifier)).resolves.toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('changes the challenge when the verifier changes', async () => {
    const a = await codeChallengeS256(randomCodeVerifier());
    const b = await codeChallengeS256(randomCodeVerifier());
    expect(a).not.toBe(b);
  });
});
