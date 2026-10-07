import { describe, it, expect } from 'vitest';
import { STALE_SYNC_MS, relativeAge, syncStatus } from '../status';

const now = Date.parse('2026-10-05T12:00:00Z');
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe('strava sync status', () => {
  it('says plainly that nothing has synced, and names the path that works today', () => {
    for (const input of [undefined, null, {}]) {
      const s = syncStatus(input, now);
      expect(s.tone).toBe('warn');
      expect(s.label).toBe('Not synced yet');
      // Strava is the primary pipeline now: connect is the first path named
      expect(s.detail).toMatch(/connect strava in settings/i);
      expect(s.detail).toMatch(/gpx\/tcx import also works/i);
    }
  });

  it('does not treat a junk timestamp as a sync', () => {
    const s = syncStatus({ lastSyncAt: NaN }, now);
    expect(s.label).toBe('Not synced yet');
  });

  it('separates "connected but nothing pulled" from "never connected"', () => {
    const s = syncStatus({ accessToken: 'at-1' }, now);
    expect(s.label).toBe('Connected, nothing pulled yet');
    // it must not tell a connected rider to connect again — it names the auto-sync instead
    expect(s.detail).toMatch(/syncs on its own/i);
    expect(s.detail).toMatch(/sync now/i);
    // and the never-connected wording is untouched when there is no token
    expect(syncStatus({ lastSyncAt: NaN }, now).label).toBe('Not synced yet');
  });

  it('calls a fresh sync current, so an empty day reads as "no ride", not "broken"', () => {
    const s = syncStatus({ lastSyncAt: now - 2 * HOUR }, now);
    expect(s.tone).toBe('ok');
    expect(s.label).toBe('Synced 2 h ago');
    expect(s.detail).toMatch(/no ride was recorded/i);
  });

  it('does not yet call a 24-hour-old sync stale', () => {
    expect(STALE_SYNC_MS).toBe(DAY);
    expect(syncStatus({ lastSyncAt: now - DAY }, now).tone).toBe('ok');
  });

  it('flags a sync older than a day as needing one, with the age', () => {
    const s = syncStatus({ lastSyncAt: now - 2 * DAY }, now);
    expect(s.tone).toBe('warn');
    expect(s.label).toBe('Needs sync');
    expect(s.detail).toContain('2 days ago');
    // it must not claim imported files are affected — they are not
    expect(s.detail).toMatch(/imported files stay/i);
  });

  describe('relativeAge', () => {
    it('formats each magnitude the way a rider would say it', () => {
      expect(relativeAge(now - 10_000, now)).toBe('just now');
      expect(relativeAge(now - 5 * MIN, now)).toBe('5 min ago');
      expect(relativeAge(now - 3 * HOUR, now)).toBe('3 h ago');
      expect(relativeAge(now - DAY, now)).toBe('yesterday');
      expect(relativeAge(now - 4 * DAY, now)).toBe('4 days ago');
    });

    it('never reports a negative age for a clock that ran backwards', () => {
      expect(relativeAge(now + 5 * MIN, now)).toBe('just now');
    });
  });
});
