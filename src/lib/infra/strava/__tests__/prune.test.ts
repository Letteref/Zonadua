import { describe, it, expect } from 'vitest';
import { STRAVA_STREAM_TTL_DAYS, expiredApiStreamIds, isExpiredApiStream } from '../prune';

const DAY = 86_400_000;
const now = Date.parse('2026-10-05T12:00:00Z');

describe('strava stream pruner', () => {
  it('keeps a stream that is exactly at the cache limit', () => {
    expect(STRAVA_STREAM_TTL_DAYS).toBe(7);
    expect(isExpiredApiStream({ source: 'strava', updatedAt: now - 7 * DAY }, now)).toBe(false);
  });

  it('expires an API-sourced stream one millisecond past the limit', () => {
    expect(isExpiredApiStream({ source: 'strava', updatedAt: now - 7 * DAY - 1 }, now)).toBe(true);
  });

  it('never expires an imported file, however old', () => {
    const ancient = now - 400 * DAY;
    expect(isExpiredApiStream({ source: 'gpx', updatedAt: ancient }, now)).toBe(false);
    expect(isExpiredApiStream({ source: 'tcx', updatedAt: ancient }, now)).toBe(false);
    expect(isExpiredApiStream({ source: 'fit', updatedAt: ancient }, now)).toBe(false);
    expect(isExpiredApiStream({ source: 'manual', updatedAt: ancient }, now)).toBe(false);
  });

  it('re-pulling a stream resets its own clock', () => {
    // refreshed yesterday: the ride may be months old, but the cached API data is fresh
    expect(isExpiredApiStream({ source: 'strava', updatedAt: now - 1 * DAY }, now)).toBe(false);
  });

  it('treats an unreadable timestamp as expired so corrupt rows cannot pin data forever', () => {
    expect(isExpiredApiStream({ source: 'strava', updatedAt: NaN }, now)).toBe(true);
  });

  it('selects only the API rows that are past their life', () => {
    const rows = [
      { id: 'api-old', source: 'strava' as const, updatedAt: now - 8 * DAY },
      { id: 'api-fresh', source: 'strava' as const, updatedAt: now - 1 * DAY },
      { id: 'file-old', source: 'gpx' as const, updatedAt: now - 400 * DAY }
    ];
    expect(expiredApiStreamIds(rows, now)).toEqual(['api-old']);
    // a shorter cache life still never reaches an imported file
    expect(expiredApiStreamIds(rows, now, 1)).toEqual(['api-old']);
  });
});
