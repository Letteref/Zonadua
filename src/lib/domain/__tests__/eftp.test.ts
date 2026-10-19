import { describe, expect, it } from 'vitest';
import {
  EFTP_EFFORT_SEC,
  EFTP_WINDOW_DAYS,
  bestTwentyMinuteEffort,
  isEftpDismissed,
  suggestEftp,
  type EftpActivityRow,
  type EftpCurveRow,
  type EftpEffort
} from '../eftp';

/**
 * What these guard: an FTP suggestion built from the rider's own rides must come from
 * a real, recent, fully-held 20-minute effort — never from demo data, never from a ride
 * too short to hold the window, and never shown twice after the rider declined it.
 * The offer itself (95% of the effort) is domain/ftp.ts' contract; here it is checked
 * only as the join between effort and suggestion.
 */

const NOW = Date.parse('2026-10-17T12:00:00');
const daysAgo = (d: number): string => new Date(NOW - d * 86_400_000).toISOString();

/** A ride that has a 1200 s curve point unless overridden. */
const ride = (
  id: string,
  date: string,
  opts: { name?: string; synthetic?: boolean } = {}
): EftpActivityRow => ({ id, date, name: opts.name ?? `Ride ${id}`, synthetic: opts.synthetic });

/** The stored curve for a ride: only the 20-minute point, at the given watts. */
const curve = (activityId: string, watts: number | null): EftpCurveRow => ({
  activityId,
  points: watts === null ? [] : [{ durationSec: EFTP_EFFORT_SEC, watts }]
});

describe('bestTwentyMinuteEffort', () => {
  it('takes the best 20-minute average among rides inside the window', () => {
    const acts = [ride('a', daysAgo(60)), ride('b', daysAgo(10))];
    const curves = [curve('a', 268), curve('b', 289)];

    const best = bestTwentyMinuteEffort(acts, curves, NOW);
    expect(best).toMatchObject({ activityId: 'b', watts: 289, name: 'Ride b' });
  });

  it('excludes rides older than the 90-day window, boundary included', () => {
    expect(EFTP_WINDOW_DAYS).toBe(90);

    const justInside = bestTwentyMinuteEffort(
      [ride('in', daysAgo(90))],
      [curve('in', 300)],
      NOW
    );
    expect(justInside?.watts).toBe(300);

    const outside = bestTwentyMinuteEffort(
      [ride('old', daysAgo(91))],
      [curve('old', 310)],
      NOW
    );
    expect(outside).toBeNull();
  });

  it('never suggests from a demo ride, even when its number would win', () => {
    const acts = [ride('real', daysAgo(5)), ride('demo', daysAgo(5), { synthetic: true })];
    const curves = [curve('real', 270), curve('demo', 400)];

    const best = bestTwentyMinuteEffort(acts, curves, NOW);
    expect(best?.activityId).toBe('real');
  });

  it('skips rides without a qualifying 20-minute window instead of counting them as zero', () => {
    const acts = [ride('no-power', daysAgo(3)), ride('short', daysAgo(3))];
    // no-power: a curve row that never materialised; short: a curve that exists but has
    // no 1200 s point (meanMaxPower only records durations the ride actually held)
    const shortCurve: EftpCurveRow = { activityId: 'short', points: [{ durationSec: 60, watts: 400 }] };

    const best = bestTwentyMinuteEffort(acts, [curve('no-power', null), shortCurve], NOW);
    expect(best).toBeNull();
  });

  it('breaks a tie on watts in favour of the newer ride', () => {
    const acts = [ride('earlier', daysAgo(40)), ride('newer', daysAgo(4))];
    const curves = [curve('earlier', 285), curve('newer', 285)];

    const best = bestTwentyMinuteEffort(acts, curves, NOW);
    expect(best?.activityId).toBe('newer');
  });

  it('returns null on empty input or an unparseable date, never a fake effort', () => {
    expect(bestTwentyMinuteEffort([], [], NOW)).toBeNull();
    expect(
      bestTwentyMinuteEffort([ride('bad', 'not-a-date')], [curve('bad', 300)], NOW)
    ).toBeNull();
  });
});

describe('suggestEftp', () => {
  const effort: EftpEffort = { activityId: 'a', name: 'Bukit Loop', date: daysAgo(4), watts: 300 };

  it('offers 95% of the effort against the logged FTP, with the delta', () => {
    const s = suggestEftp(effort, 275);
    expect(s).toMatchObject({ estimateFtp: 285, currentFtp: 275, deltaW: 10 });
    expect(s?.effort).toBe(effort); // the evidence row carries the same ride object
  });

  it('offers a first FTP when none is logged, with no delta to show', () => {
    const s = suggestEftp(effort, null);
    expect(s).toMatchObject({ estimateFtp: 285, currentFtp: null, deltaW: null });
  });

  it('has nothing to offer when the estimate equals what is logged', () => {
    expect(suggestEftp(effort, 285)).toBeNull();
  });

  it('declines a non-positive effort rather than proposing an FTP of 0', () => {
    expect(suggestEftp({ ...effort, watts: 0 }, 275)).toBeNull();
  });
});

describe('isEftpDismissed', () => {
  const effort: EftpEffort = { activityId: 'a', name: 'Loop', date: daysAgo(4), watts: 300 };
  const suggestion = suggestEftp(effort, 275)!;

  it('hides the exact suggestion the rider declined', () => {
    expect(isEftpDismissed({ activityId: 'a', ftp: 285 }, suggestion)).toBe(true);
  });

  it('shows it again when the evidence changes — another ride, or another estimate', () => {
    expect(isEftpDismissed({ activityId: 'b', ftp: 285 }, suggestion)).toBe(false);
    expect(isEftpDismissed({ activityId: 'a', ftp: 291 }, suggestion)).toBe(false);
    expect(isEftpDismissed(undefined, suggestion)).toBe(false);
  });
});
