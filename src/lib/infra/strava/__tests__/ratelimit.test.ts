import { describe, it, expect } from 'vitest';
import {
  THROTTLE_RATIO,
  parseRateLimit,
  remainingRequests,
  retryDelayMs,
  shouldThrottle,
  shortWindowResetAt
} from '../ratelimit';

/** A header map as it comes off a response. */
const headers = (map: Record<string, string>) => (name: string) => map[name] ?? null;

describe('strava rate limit', () => {
  it('reads both windows from the X-RateLimit headers', () => {
    const rl = parseRateLimit(headers({ 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': '12,340' }), 5);
    expect(rl).toEqual({ shortUsage: 12, shortLimit: 100, longUsage: 340, longLimit: 1000, readAt: 5 });
  });

  it('falls back to the newer read-scoped headers', () => {
    const rl = parseRateLimit(headers({ 'X-ReadRateLimit-Limit': '200,2000', 'X-ReadRateLimit-Usage': '1,2' }));
    expect(rl?.shortLimit).toBe(200);
    expect(rl?.longUsage).toBe(2);
  });

  it('treats an unreadable budget as unknown, never as unlimited', () => {
    expect(parseRateLimit(headers({}))).toBeNull();
    expect(parseRateLimit(headers({ 'X-RateLimit-Limit': '100', 'X-RateLimit-Usage': '1,2' }))).toBeNull();
    expect(parseRateLimit(headers({ 'X-RateLimit-Limit': 'nope,1000', 'X-RateLimit-Usage': '1,2' }))).toBeNull();
  });

  describe('shouldThrottle — the 80% boundary', () => {
    const rl = (shortUsage: number, longUsage = 0) => ({
      shortUsage,
      shortLimit: 100,
      longUsage,
      longLimit: 1000,
      readAt: 0
    });

    it('keeps syncing just under the threshold', () => {
      expect(THROTTLE_RATIO).toBe(0.8);
      expect(shouldThrottle(rl(79))).toBe(false);
    });

    it('stops at exactly the threshold, not one request later', () => {
      expect(shouldThrottle(rl(80))).toBe(true);
    });

    it('stops on the daily window too, even when the short one is fresh', () => {
      expect(shouldThrottle(rl(0, 799))).toBe(false);
      expect(shouldThrottle(rl(0, 800))).toBe(true);
    });

    it('refuses to continue on a limit it could not trust', () => {
      expect(shouldThrottle({ ...rl(0), shortLimit: 0 })).toBe(true);
      expect(shouldThrottle({ ...rl(0), longLimit: -1 })).toBe(true);
    });
  });

  it('reports what is left in the tighter window', () => {
    expect(remainingRequests({ shortUsage: 90, shortLimit: 100, longUsage: 10, longLimit: 1000, readAt: 0 })).toBe(10);
    expect(remainingRequests({ shortUsage: 0, shortLimit: 100, longUsage: 990, longLimit: 1000, readAt: 0 })).toBe(10);
    expect(remainingRequests({ shortUsage: 500, shortLimit: 100, longUsage: 0, longLimit: 1000, readAt: 0 })).toBe(0);
  });

  it('aims the retry at the next quarter-hour boundary', () => {
    const base = Date.parse('2026-10-05T10:07:00Z');
    expect(shortWindowResetAt(base)).toBe(Date.parse('2026-10-05T10:15:00Z'));

    // on the boundary itself the next one is 15 min away, never zero
    const onBoundary = Date.parse('2026-10-05T10:15:00Z');
    expect(shortWindowResetAt(onBoundary)).toBe(Date.parse('2026-10-05T10:30:00Z'));

    const rl = { shortUsage: 99, shortLimit: 100, longUsage: 0, longLimit: 1000, readAt: base };
    expect(retryDelayMs(rl, base)).toBe(8 * 60 * 1000);
    // a retry that has already outlived its window must not be negative
    expect(retryDelayMs(rl, base + 60 * 60 * 1000)).toBe(0);
  });
});
