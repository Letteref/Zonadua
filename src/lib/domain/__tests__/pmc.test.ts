import { describe, expect, it } from 'vitest';
import {
  ATL_TAU,
  CTL_TAU,
  DEFAULT_WEEKLY_TSS_TARGET,
  computePmc,
  dailyTss,
  formState,
  hasPmcLoad,
  weeklyTssTarget
} from '../pmc';

/** Fixed clock so every assertion is reproducible. */
const NOW = new Date('2026-10-02T12:00:00.000Z');
const iso = (offsetDays: number): string => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10);
};

describe('dailyTss', () => {
  it('sums several activities on the same day', () => {
    // local-naive wall-clock, the shape the DB stores (Strava mapper writes it that way)
    const map = dailyTss([
      { date: '2026-10-01T06:00:00', tss: 40 },
      { date: '2026-10-01T18:30:00', tss: 35 }
    ]);
    expect(map.get('2026-10-01')).toBeCloseTo(75, 6);
    expect(map.size).toBe(1);
  });

  it('buckets a UTC timestamp by the local calendar day, not the UTC day', () => {
    // 18:30 UTC is already past local midnight in zones ahead of UTC (01:30 on the 2nd
    // in UTC+7): the ride belongs to the day the rider was on. The expected key is read
    // back from the same instant through local accessors, so the assertion holds in
    // whatever zone the suite runs in.
    const d = new Date('2026-10-01T18:30:00Z');
    const localKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const map = dailyTss([{ date: '2026-10-01T18:30:00Z', tss: 35 }]);
    expect(map.get(localKey)).toBe(35);
  });

  it('treats a missing TSS as zero load', () => {
    const map = dailyTss([{ date: '2026-10-01T06:00:00' }]);
    expect(map.get('2026-10-01')).toBe(0);
  });
});

describe('computePmc', () => {
  it('matches hand-computed EMA values for three 100-TSS days', () => {
    // ctl₀=0, atl₀=0; each day: x += (load − x) / τ
    // day1 ctl 2.381  atl 14.286  tsb −11.9
    // day2 ctl 4.707  atl 26.531  tsb −21.8
    // day3 ctl 6.976  atl 37.026  tsb −30.1
    const items = [0, 1, 2].map((back) => ({ date: iso(back), tss: 100 }));
    const points = computePmc(items, 2, NOW);

    expect(points).toHaveLength(3);
    expect(points.map((p) => p.ctl)).toEqual([2.4, 4.7, 7]);
    expect(points.map((p) => p.atl)).toEqual([14.3, 26.5, 37]);
    expect(points.map((p) => p.tsb)).toEqual([-11.9, -21.8, -30.1]);
  });

  it('converges to the closed form under constant load', () => {
    // after n days of a constant daily load L starting from 0:
    //   ema_n = L × (1 − (1 − 1/τ)^n)
    const load = 100;
    const span = 60;
    const items = Array.from({ length: span }, (_, i) => ({ date: iso(span - 1 - i), tss: load }));
    const points = computePmc(items, span, NOW);

    // the loop starts one day before the first load, so 60 loaded steps run
    const closedForm = load * (1 - (1 - 1 / CTL_TAU) ** span);
    const last = points.at(-1)!;
    expect(last.ctl).toBeCloseTo(closedForm, 1);
  });

  it('keeps TSB equal to CTL − ATL on every day', () => {
    const items = [0, 1, 2, 3, 4].map((back, i) => ({ date: iso(back), tss: 40 + i * 20 }));
    for (const p of computePmc(items, 5, NOW)) {
      // TSB is derived from the unrounded EMAs, so the published 1-decimal values
      // can disagree by up to 0.1 — never more.
      expect(Math.abs(p.tsb - (p.ctl - p.atl))).toBeLessThanOrEqual(0.15);
    }
  });

  it('decays toward zero when training stops', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ date: iso(40 - i), tss: 100 }));
    const points = computePmc(items, 90, NOW);
    const loaded = points.find((p) => p.date === iso(1))!; // last day that carried load
    const rested = points.at(-1)!; // today, one day into a rest block
    expect(rested.ctl).toBeLessThan(loaded.ctl);
    expect(rested.atl).toBeLessThan(loaded.atl);
    expect(rested.tsb).toBeGreaterThan(loaded.tsb);
  });

  it('ATL reacts faster than CTL to a fresh load spike', () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ date: iso(60 - i), tss: 50 }));
    items.push({ date: iso(0), tss: 300 });
    const points = computePmc(items, 60, NOW);
    const last = points.at(-1)!;
    // one day of 300 TSS moves ATL far more than CTL
    expect(last.atl).toBeGreaterThan(30);
    expect(last.ctl).toBeLessThan(70);
  });

  it('starts from zero fitness with no history', () => {
    const points = computePmc([], 7, NOW);
    expect(points).toHaveLength(8);
    expect(points.every((p) => p.ctl === 0 && p.atl === 0 && p.tsb === 0)).toBe(true);
  });

  it('is deterministic for identical input', () => {
    const items = [{ date: iso(1), tss: 70 }, { date: iso(0), tss: 90 }];
    expect(computePmc(items, 30, NOW)).toEqual(computePmc(items, 30, NOW));
  });

  it('emits one point per day including both endpoints', () => {
    const points = computePmc([], 30, NOW);
    expect(points[0].date).toBe(iso(30));
    expect(points.at(-1)!.date).toBe(iso(0));
  });

  it('exposes the documented time constants', () => {
    expect(CTL_TAU).toBe(42);
    expect(ATL_TAU).toBe(7);
  });
});

describe('formState', () => {
  it('maps TSB bands to training-state labels', () => {
    expect(formState(-40)).toBe('fresh');
    expect(formState(-20)).toBe('detraining');
    expect(formState(0)).toBe('balanced');
    expect(formState(15)).toBe('productive');
    expect(formState(30)).toBe('peaking');
  });
});

describe('hasPmcLoad', () => {
  const day = (offset: number, tss: number) => ({
    date: new Date(Date.UTC(2026, 0, 1 + offset)).toISOString(),
    tss
  });

  it('is false for a window that never saw a ride', () => {
    expect(hasPmcLoad(computePmc([], 90, new Date('2026-04-01T00:00:00Z')))).toBe(false);
  });

  it('is false when every activity in the window scored zero', () => {
    // The bug: a ride with no power data still produces a PMC row, so the window looks
    // populated while CTL and ATL never leave zero.
    const zeroLoad = [day(0, 0), day(1, 0), day(2, 0)];
    expect(hasPmcLoad(computePmc(zeroLoad, 90, new Date('2026-04-01T00:00:00Z')))).toBe(false);
  });

  it('is true as soon as one day carries load', () => {
    const oneRide = [day(0, 60)];
    expect(hasPmcLoad(computePmc(oneRide, 90, new Date('2026-04-01T00:00:00Z')))).toBe(true);
  });

  it('still reads load after a long rest inside the window', () => {
    // The decay tail is the point: a rider who trained in March and stopped in May has
    // genuinely converged fitness and fatigue, and TSB 0 means something there.
    const stale = [day(0, 80), day(40, 0), day(70, 0), day(89, 0)];
    const series = computePmc(stale, 90, new Date('2026-04-01T00:00:00Z'));
    expect(hasPmcLoad(series)).toBe(true);
    expect(series.at(-1)!.ctl).toBeGreaterThan(0);
  });

  it('reads the series, not the inputs, so an out-of-window ride does not count', () => {
    // A ride older than the window must not make the dashboard claim there is load, because
    // the curve beside it is still flat zero.
    const ancient = [{ date: '2019-01-01T00:00:00.000Z', tss: 300 }];
    expect(hasPmcLoad(computePmc(ancient, 90, new Date('2026-04-01T00:00:00Z')))).toBe(false);
  });
});

describe('weeklyTssTarget', () => {
  // Mid-window days (3, 10, 17, 24 days back) so the assertions do not depend on
  // boundary arithmetic — the point of these tests is the averaging, not the edges.
  const ride = (daysBack: number, tss?: number) => ({ date: iso(daysBack), tss });

  it('falls back to the default when there is no history at all', () => {
    expect(weeklyTssTarget([], NOW)).toBe(DEFAULT_WEEKLY_TSS_TARGET);
  });

  it('falls back when history exists but no week inside the window carried load', () => {
    // A rider whose last ride was two months ago: nothing to average, so the same honest
    // default a new rider gets — not 0, which every week would clear for free.
    expect(weeklyTssTarget([ride(70, 300), ride(90, 200)], NOW)).toBe(DEFAULT_WEEKLY_TSS_TARGET);
  });

  it('averages the weeks that carried load, rounded to the nearest 25', () => {
    // weeks 1–3 carry 500 / 400 / 300 → mean 400; week 4 is empty and excluded
    const items = [ride(3, 500), ride(10, 400), ride(17, 300)];
    expect(weeklyTssTarget(items, NOW)).toBe(400);
  });

  it('rounds to the nearest 25 rather than to the integer mean', () => {
    // mean of 300 and 410 is 355 → nearest 25 is 350
    const items = [ride(3, 300), ride(10, 410)];
    expect(weeklyTssTarget(items, NOW)).toBe(350);
  });

  it('floors tiny weeks at 50 so an easy week still has a number to aim at', () => {
    const items = [ride(3, 20)];
    expect(weeklyTssTarget(items, NOW)).toBe(50);
  });

  it('uses the injected clock, not the wall clock', () => {
    // Same ride: at NOW it sits in week 3; relative to a clock a year later it is out of
    // the window entirely and the target falls back to the default.
    const items = [ride(17, 400)];
    expect(weeklyTssTarget(items, NOW)).toBe(400);
    const muchLater = new Date('2027-10-02T12:00:00.000Z');
    expect(weeklyTssTarget(items, muchLater)).toBe(DEFAULT_WEEKLY_TSS_TARGET);
  });
});