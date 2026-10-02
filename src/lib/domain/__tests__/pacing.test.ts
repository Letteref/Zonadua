import { describe, expect, it } from 'vitest';
import {
  buildPlan,
  clockOf,
  durationOf,
  planSeries,
  resolveTargetWatts,
  slowestWindows,
  totalStopSec
} from '../pacing';
import type { ProfilePoint, RideSolution, Segment } from '../physics';

const PHYSICS = {
  riderKg: 68,
  bikeKg: 9.4,
  crr: 0.0045,
  cda: 0.32,
  airDensity: 1.225,
  drivetrainLoss: 0.025
};

/** 200 km road route: rolling opening, one big climb to 1450 m, fast descent home. */
const profile: ProfilePoint[] = [
  { distKm: 0, altM: 145 },
  { distKm: 25, altM: 160 },
  { distKm: 50, altM: 140 },
  { distKm: 75, altM: 120 },
  { distKm: 100, altM: 128 },
  { distKm: 120, altM: 300 },
  { distKm: 140, altM: 700 },
  { distKm: 150, altM: 1000 },
  { distKm: 160, altM: 1200 },
  { distKm: 168, altM: 1350 },
  { distKm: 174, altM: 1450 },
  { distKm: 178, altM: 1200 },
  { distKm: 185, altM: 800 },
  { distKm: 195, altM: 400 },
  { distKm: 200, altM: 150 }
];

const base = {
  profile,
  physics: PHYSICS,
  pacing: { mode: 'if' as const, ifTarget: 0.7, ftp: 275 },
  stops: { count: 3, minutesEach: 10 },
  startMin: 5 * 60 + 30,
  checkpoints: [
    { km: 25, label: 'Rolling Flats' },
    { km: 87, label: 'Koto Tinggi Climb' },
    { km: 120, label: 'CP2 Payakumbuh', cutoffMin: 15 * 60 },
    { km: 160, label: 'Danau Maninjau Wall' },
    { km: 200, label: 'Finish Line' }
  ]
};

describe('resolveTargetWatts', () => {
  it('turns IF × FTP into a power target', () => {
    expect(resolveTargetWatts({ mode: 'if', ifTarget: 0.7, ftp: 275 })).toBe(192.5);
  });

  it('passes through an absolute target', () => {
    expect(resolveTargetWatts({ mode: 'constant', watts: 180 })).toBe(180);
    expect(resolveTargetWatts({ mode: 'np', watts: 210 })).toBe(210);
  });

  it('returns 0 rather than dividing by an unknown FTP', () => {
    expect(resolveTargetWatts({ mode: 'if', ifTarget: 0.7, ftp: 0 })).toBe(0);
    expect(resolveTargetWatts({ mode: 'if', ifTarget: 0.7 })).toBe(0);
  });
});

describe('totalStopSec', () => {
  it('multiplies count by minutes', () => {
    expect(totalStopSec({ count: 3, minutesEach: 10 })).toBe(1800);
    expect(totalStopSec({ count: 0, minutesEach: 10 })).toBe(0);
  });

  it('never returns a negative penalty', () => {
    expect(totalStopSec({ count: -2, minutesEach: 10 })).toBe(0);
  });
});

describe('buildPlan', () => {
  it('produces a full plan for a valid profile and target', () => {
    const plan = buildPlan(base);
    expect(plan.ok).toBe(true);
    expect(plan.targetWatts).toBeCloseTo(192.5, 6);
    expect(plan.movingSec!).toBeGreaterThan(0);
    expect(plan.elapsedSec!).toBeCloseTo(plan.movingSec! + plan.stopSec, 6);
    expect(plan.climbM!).toBeGreaterThan(1200);
    expect(plan.energyKJ!).toBeGreaterThan(3000);
  });

  it('refuses to guess when the profile is empty', () => {
    const plan = buildPlan({ ...base, profile: [{ distKm: 0, altM: 100 }] });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toMatch(/empty/i);
    expect(plan.checkpoints).toEqual([]);
  });

  it('refuses to guess without an FTP for an IF strategy', () => {
    const plan = buildPlan({ ...base, pacing: { mode: 'if', ifTarget: 0.7, ftp: 0 } });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toMatch(/FTP/i);
  });

  it('is faster at a higher intensity factor', () => {
    const easy = buildPlan({ ...base, pacing: { mode: 'if', ifTarget: 0.65, ftp: 275 } });
    const hard = buildPlan({ ...base, pacing: { mode: 'if', ifTarget: 0.8, ftp: 275 } });
    expect(hard.movingSec!).toBeLessThan(easy.movingSec!);
  });

  it('adds stops to elapsed time but not to riding time', () => {
    const noStops = buildPlan({ ...base, stops: { count: 0, minutesEach: 10 } });
    const withStops = buildPlan(base);
    expect(withStops.movingSec).toBeCloseTo(noStops.movingSec!, 6);
    expect(withStops.elapsedSec!).toBeGreaterThan(withStops.movingSec!);
    expect(withStops.elapsedSec! - withStops.movingSec!).toBeCloseTo(1800, 6);
  });

  it('produces monotonic checkpoint times', () => {
    const { checkpoints } = buildPlan(base);
    for (let i = 1; i < checkpoints.length; i++) {
      expect(checkpoints[i].elapsedSec).toBeGreaterThan(checkpoints[i - 1].elapsedSec);
      expect(checkpoints[i].clockMin).toBeGreaterThan(checkpoints[i - 1].clockMin);
    }
  });

  it('measures each leg from the previous checkpoint, not from the start', () => {
    const { checkpoints } = buildPlan(base);
    // leg pace should differ per leg — a climb leg is slower than a descent leg
    const paces = checkpoints.map((c) => c.legKph);
    expect(new Set(paces.map((p) => p.toFixed(1))).size).toBeGreaterThan(1);
    for (const p of paces) expect(p).toBeGreaterThan(5);
  });

  it('places every checkpoint inside the ride', () => {
    const { checkpoints, solution } = buildPlan(base);
    for (const c of checkpoints) {
      expect(c.km).toBeLessThanOrEqual(solution!.totalDistKm + 0.001);
    }
  });

  it('absorbs all the stops by the finish, so the last checkpoint equals the estimate', () => {
    const plan = buildPlan(base);
    const last = plan.checkpoints.at(-1)!;
    expect(last.elapsedSec).toBeCloseTo(plan.elapsedSec!, 1);
    expect(last.clockMin).toBeCloseTo(plan.finishClockMin!, 3);
  });

  it('computes buffer against a cut-off, negative when late', () => {
    const { checkpoints } = buildPlan(base);
    const cp2 = checkpoints.find((c) => c.label === 'CP2 Payakumbuh')!;
    expect(cp2.bufferMin).toBeDefined();
    expect(cp2.bufferMin).toBeCloseTo(15 * 60 - cp2.clockMin, 6);
  });

  it('omits the buffer where there is no cut-off', () => {
    const { checkpoints } = buildPlan(base);
    expect(checkpoints.find((c) => c.label === 'Rolling Flats')!.bufferMin).toBeUndefined();
  });

  it('reports the slowest segment as the hardest part of the ride', () => {
    const { hardest } = buildPlan(base);
    expect(hardest).toBeDefined();
    expect(hardest!.vKph).toBeGreaterThan(0);
    expect(hardest!.vKph).toBeLessThan(40);
  });

  it('honours a descent speed cap', () => {
    const capped = buildPlan({ ...base, vMaxKph: 30 });
    const free = buildPlan(base);
    expect(capped.movingSec!).toBeGreaterThan(free.movingSec!);
  });

  it('is slower with cargo and a headwind', () => {
    const loaded = buildPlan({ ...base, physics: { ...PHYSICS, cargoKg: 5 } });
    const windy = buildPlan({ ...base, physics: { ...PHYSICS, headwindKph: 25 } });
    const plain = buildPlan(base);
    expect(loaded.movingSec!).toBeGreaterThan(plain.movingSec!);
    expect(windy.movingSec!).toBeGreaterThan(plain.movingSec!);
  });

  it('estimates a 200 km road race in a believable window', () => {
    const { elapsedSec } = buildPlan(base);
    const hours = elapsedSec! / 3600;
    // 200 km with 1345 m of climbing at IF 0.7 including three stops: ~6.5–9 hours
    expect(hours).toBeGreaterThan(6.5);
    expect(hours).toBeLessThan(9.5);
  });

  it('labels unnamed checkpoints by distance', () => {
    const plan = buildPlan({ ...base, checkpoints: [{ km: 40 }] });
    expect(plan.checkpoints[0].label).toBe('KM 40');
  });
});

describe('clockOf / durationOf', () => {
  it('formats a clock', () => {
    expect(clockOf(5 * 60 + 30)).toBe('05:30');
    expect(clockOf(15 * 60)).toBe('15:00');
    expect(clockOf(0)).toBe('00:00');
    expect(clockOf(23 * 60 + 59)).toBe('23:59');
  });

  it('wraps past midnight rather than printing 24:xx', () => {
    expect(clockOf(24 * 60 + 5)).toBe('00:05');
  });

  it('formats a duration', () => {
    expect(durationOf(5400)).toBe('1h 30m');
    expect(durationOf(1800)).toBe('30m');
    expect(durationOf(3599)).toBe('1h 00m');
    expect(durationOf(0)).toBe('0m');
  });
});
describe('planSeries', () => {
  it('starts at km 0 so the chart covers the whole route', () => {
    const rows = planSeries(buildPlan(base));
    expect(rows[0].km).toBe(0);
    expect(rows.at(-1)!.km).toBeCloseTo(200, 6);
  });

  it('reconstructs the start altitude from the first segment', () => {
    const rows = planSeries(buildPlan(base));
    // first segment ends at 160 m having risen 15 m, so the start was 145 m
    expect(rows[0].altM).toBeCloseTo(145, 3);
    expect(rows[0].elapsedSec).toBe(0);
  });

  it('accrues stops with distance so the last row matches the finish estimate', () => {
    const plan = buildPlan(base);
    const rows = planSeries(plan);
    expect(rows.at(-1)!.elapsedSec).toBeCloseTo(plan.elapsedSec!, 6);
    expect(rows.at(-1)!.clockMin).toBeCloseTo(plan.finishClockMin!, 9);
  });

  it('is monotonic in distance and in elapsed time', () => {
    const rows = planSeries(buildPlan(base));
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].km).toBeGreaterThan(rows[i - 1].km);
      expect(rows[i].elapsedSec).toBeGreaterThanOrEqual(rows[i - 1].elapsedSec);
    }
  });

  it('keeps km 0 and the finish when decimating a long route', () => {
    const rows = planSeries(buildPlan(base), 40);
    expect(rows.length).toBeLessThanOrEqual(40);
    expect(rows[0].km).toBe(0);
    expect(rows.at(-1)!.km).toBeCloseTo(200, 6);
  });

  it('keeps every wall the UI needs to warn about', () => {
    // 36 W cannot hold the 3% ramps of this route at the 5 km/h stall floor
    const plan = buildPlan({ ...base, pacing: { mode: 'constant', watts: 36 } });
    const walls = plan.solution!.segments.filter((s) => s.powerLimited);
    expect(walls.length).toBeGreaterThan(0);

    const rows = planSeries(plan, 1200);
    expect(rows.length).toBeLessThanOrEqual(1200);
    for (const w of walls) {
      expect(rows.some((r) => Math.abs(r.km - w.cumDistKm) < 1e-6)).toBe(true);
    }
    expect(rows.filter((r) => r.powerLimited).length).toBe(walls.length);
  });

  it('respects the budget when the walls alone would exceed it', () => {
    const plan = buildPlan({ ...base, pacing: { mode: 'constant', watts: 36 } });
    const rows = planSeries(plan, 30);
    expect(rows.length).toBeLessThanOrEqual(30);
    expect(rows[0].km).toBe(0);
    expect(rows.at(-1)!.km).toBeCloseTo(200, 6);
  });

  it('returns nothing when there is no plan to draw', () => {
    expect(planSeries(buildPlan({ ...base, pacing: { mode: 'if', ifTarget: 0.7, ftp: 0 } }))).toEqual([]);
    expect(planSeries(buildPlan({ ...base, profile: [{ distKm: 0, altM: 100 }] }))).toEqual([]);
  });
});

describe('slowestWindows', () => {
  /**
   * Flat 100 km at `kph`, sampled every 10 km.
   * Mirrors the real solver: `distKm` is the distance at the segment's END and
   * `cumDistKm` is the running total, so they differ.
   */
  function solution(kph = 30): RideSolution {
    const stepKm = 10;
    const secPerStep = (stepKm / kph) * 3600;
    const segments: Segment[] = [];
    for (let i = 0; i < 10; i++) {
      segments.push({
        i,
        distKm: stepKm * (i + 1),
        altM: 100,
        riseM: 0,
        gradePct: 0,
        vKph: kph,
        sec: secPerStep,
        cumDistKm: stepKm * (i + 1),
        cumTimeSec: secPerStep * (i + 1),
        powerLimited: false,
        powerUsedW: 200
      });
    }
    return {
      segments,
      totalTimeSec: secPerStep * 10,
      totalDistKm: 100,
      climbM: 0,
      descentM: 0,
      avgKph: kph,
      powerLimitedCount: 0,
      powerLimitedPct: 0,
      peakRequiredW: 200
    };
  }

  it('returns nothing for a solution it cannot measure', () => {
    const empty = solution();
    expect(slowestWindows({ ...empty, segments: [] }, 3)).toEqual([]);
    expect(slowestWindows({ ...empty, segments: [empty.segments[0]] }, 3)).toEqual([]);
  });

  it('splits the route into non-overlapping windows in route order', () => {
    const w = slowestWindows(solution(), 3, 20);
    expect(w).toHaveLength(3);
    expect(w[0].fromKm).toBe(0);
    for (let i = 1; i < w.length; i++) {
      expect(w[i].fromKm).toBeGreaterThanOrEqual(w[i - 1].toKm);
    }
  });

  it('reports the solved speed, time and power of each window', () => {
    const [w] = slowestWindows(solution(), 1, 20);
    expect(w.kph).toBeCloseTo(30, 6);
    expect(w.mins).toBeCloseTo(40, 6); // 20 km at 30 km/h
    expect(w.watts).toBeCloseTo(200, 6);
    expect(w.gradePct).toBeCloseTo(0, 6);
  });

  it('finds the genuinely slow stretch rather than the first one', () => {
    const base = solution();
    const segs = base.segments.map((s) => ({ ...s }));
    // km 50-60 crawls at 10 km/h: triple its time and drop its speed
    segs[5] = { ...segs[5], vKph: 10, sec: segs[5].sec * 3, powerUsedW: 320 };
    const sol: RideSolution = { ...base, segments: segs };
    const picked = slowestWindows(sol, 1, 10);
    expect(picked[0].fromKm).toBe(50);
    expect(picked[0].toKm).toBe(60);
    expect(picked[0].kph).toBeCloseTo(10, 6);
    expect(picked[0].watts).toBeCloseTo(320, 6);
    expect(picked[0].mins).toBeCloseTo(60, 6); // 10 km at 10 km/h
  });

  it('never reports a speed above the fastest segment it was given', () => {
    // Regression: summing Segment.distKm (an end-distance, not a length) compounds the
    // route length and invented a 250 km/h "slow" descent on a 55 km/h-capped route.
    const fast = solution(55);
    for (const w of slowestWindows(fast, 3, 10)) {
      expect(w.kph).toBeLessThanOrEqual(55.000001);
    }
  });

  it('weights the gradient by distance, not by counting segments', () => {
    const base = solution();
    const segs = base.segments.map((s) => ({ ...s, riseM: 0 }));
    segs[0] = { ...segs[0], riseM: 100 }; // 10 km rising 100 m
    segs[1] = { ...segs[1], riseM: 0 };
    const sol: RideSolution = { ...base, segments: segs };
    const [w] = slowestWindows(sol, 1, 20);
    // 100 m of rise over 20 km → 0.5 %, not 1 % (which a per-segment mean would give)
    expect(w.gradePct).toBeCloseTo(0.5, 6);
  });

  it('reports window widths that add up to the route, not more', () => {
    const w = slowestWindows(solution(), 3, 10);
    for (const x of w) {
      expect(x.toKm - x.fromKm).toBeCloseTo(10, 6);
    }
    // and the km it reports is the middle of the window it actually walked
    expect(w[0].km).toBeCloseTo((w[0].fromKm + w[0].toKm) / 2, 6);
  });
});
