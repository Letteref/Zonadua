import { describe, expect, it } from 'vitest';
import {
  AMAN_MIN,
  clockAtKm,
  feasibility,
  gateBufferAt,
  kmAtClock,
  lastGatePassed,
  planMinutesBetween,
  raceOutcome,
  readoutOfOutcomes,
  sustainAt,
  wPrimeSpentAt
} from '../race';
import type { PlanSeriesPoint } from '../pacing';
import type { Segment } from '../physics';

/**
 * Flat 100 km at 30 km/h from a 05:30 gun, sampled every 10 km.
 * 30 km/h = 0.5 km/min, so every 10 km costs 20 min: km 50 → 07:10 (430 min),
 * km 90 → 08:30 (510 min), km 100 → 08:50 (530 min).
 */
function rows(): PlanSeriesPoint[] {
  const out: PlanSeriesPoint[] = [];
  for (let i = 0; i <= 10; i++) {
    out.push({
      km: i * 10,
      altM: 100,
      gradePct: 0,
      kph: 30,
      elapsedSec: i * 1200,
      clockMin: 330 + i * 20,
      powerLimited: false
    });
  }
  return out;
}

/** CP1 has 40 min of slack at km 50; the finish cut-off is 15 min *inside* the plan. */
const GATES = [
  { km: 50, cutoffMin: 450, label: 'CP1' },
  { km: 100, cutoffMin: 515, label: 'Finish' }
];

describe('feasibility', () => {
  it('splits at zero and at the comfort threshold', () => {
    expect(feasibility(30)).toBe('aman');
    expect(feasibility(AMAN_MIN)).toBe('aman');
    expect(feasibility(AMAN_MIN - 0.01)).toBe('waspada');
    expect(feasibility(0)).toBe('waspada');
    expect(feasibility(-0.01)).toBe('kritis');
    expect(feasibility(-90)).toBe('kritis');
  });
});

describe('gateBufferAt', () => {
  it('measures the gate exactly at the hovered point', () => {
    // plan hits km 50 at 07:10 = 430 min, cut-off 07:30 = 450 → +20
    const p = gateBufferAt(rows(), GATES, 50)!;
    expect(p.gateKm).toBe(50);
    expect(p.gateLabel).toBe('CP1');
    expect(p.bufferMin).toBeCloseTo(20, 6);
    expect(p.remainingKm).toBe(0);
    expect(p.feasibility).toBe('aman');
  });

  it('holds the same gate while the rider is still approaching it', () => {
    // 15 km before CP1 the plan arrives at 06:40 — still measured against CP1, not Finish
    const p = gateBufferAt(rows(), GATES, 35)!;
    expect(p.gateKm).toBe(50);
    expect(p.gateLabel).toBe('CP1');
    expect(p.remainingKm).toBeCloseTo(15, 6);
    expect(p.clockMin).toBeCloseTo(400, 6);
  });

  it('switches to the finish gate once the last cut-off is behind the rider', () => {
    // past CP1 at km 60 (clock 450); Finish cut-off 515 → +65
    const p = gateBufferAt(rows(), GATES, 60)!;
    expect(p.gateKm).toBe(100);
    expect(p.gateLabel).toBe('Finish');
    expect(p.bufferMin).toBeCloseTo(65, 6);
    expect(p.remainingKm).toBeCloseTo(40, 6);
  });

  it('reports KRITIS when the plan misses the cut-off', () => {
    // km 90 → clock 510, finish cut-off 515 → +5 min: inside the danger band
    expect(gateBufferAt(rows(), GATES, 90)!.feasibility).toBe('waspada');
    // the plan itself finishes at 530, which is 15 min after the cut-off
    const finish = gateBufferAt(rows(), GATES, 100)!;
    expect(finish.bufferMin).toBeCloseTo(-15, 6);
    expect(finish.feasibility).toBe('kritis');
  });

  it('interpolates between rows so the clock is continuous', () => {
    const p = gateBufferAt(rows(), GATES, 55)!;
    expect(p.clockMin).toBeCloseTo(440, 6); // 07:20
    expect(p.kph).toBeCloseTo(30, 6);
    expect(p.remainingKm).toBeCloseTo(45, 6); // CP1 is behind at 55
  });

  it('clamps outside the route instead of extrapolating a fiction', () => {
    expect(gateBufferAt(rows(), GATES, -5)!.clockMin).toBeCloseTo(330, 6);
    expect(gateBufferAt(rows(), GATES, 999)!.clockMin).toBeCloseTo(530, 6);
  });

  it('returns null when there is nothing to measure against', () => {
    expect(gateBufferAt(rows(), [], 50)).toBeNull();
    expect(gateBufferAt([], GATES, 50)).toBeNull();
  });

  it('labels an unnamed gate with its distance', () => {
    const p = gateBufferAt(rows(), [{ km: 60, cutoffMin: 460 }], 60)!;
    expect(p.gateLabel).toBe('KM 60');
  });
});

describe('lastGatePassed', () => {
  it('returns the most recent gate behind the rider', () => {
    expect(lastGatePassed(GATES, 10)).toBeNull();
    expect(lastGatePassed(GATES, 60)?.label).toBe('CP1');
    expect(lastGatePassed(GATES, 150)?.label).toBe('Finish');
  });
});
describe('clockAtKm', () => {
  it('reads the plan clock at a distance', () => {
    expect(clockAtKm(rows(), 50)).toBeCloseTo(430, 6); // 07:10
    expect(clockAtKm(rows(), 90)).toBeCloseTo(510, 6); // 08:30
  });

  it('interpolates so a hovered distance gives a continuous clock', () => {
    expect(clockAtKm(rows(), 55)!).toBeCloseTo(440, 6);
    expect(clockAtKm(rows(), 57.5)!).toBeCloseTo(445, 6);
  });

  it('clamps outside the route and rejects an empty plan', () => {
    expect(clockAtKm(rows(), -10)).toBeCloseTo(330, 6);
    expect(clockAtKm(rows(), 999)).toBeCloseTo(530, 6);
    expect(clockAtKm([], 50)).toBeNull();
  });
});

describe('kmAtClock', () => {
  it('is the inverse of clockAtKm on the plan rows', () => {
    expect(kmAtClock(rows(), 430)!).toBeCloseTo(50, 6);
    expect(kmAtClock(rows(), 510)!).toBeCloseTo(90, 6);
    expect(kmAtClock(rows(), 445)!).toBeCloseTo(57.5, 6);
  });

  it('round-trips against clockAtKm at arbitrary points', () => {
    const r = rows();
    for (const km of [3, 17.5, 42, 66.25, 99]) {
      const clock = clockAtKm(r, km)!;
      expect(kmAtClock(r, clock)!).toBeCloseTo(km, 6);
    }
  });

  it('clamps to the route ends rather than running off it', () => {
    expect(kmAtClock(rows(), 100)).toBeCloseTo(0, 6); // before the gun
    expect(kmAtClock(rows(), 9999)).toBeCloseTo(100, 6); // long past the finish
    expect(kmAtClock(rows(), 400)).toBeCloseTo(35, 6); // 07:40 on this plan = km 35
    expect(kmAtClock([], 400)).toBeNull();
    expect(kmAtClock([rows()[0]], 400)).toBeNull(); // nothing to interpolate against
  });
});

describe('planMinutesBetween', () => {
  it('measures the plan time still left from where the rider is', () => {
    // from km 50 (07:10) to the finish at km 100 (08:50) = 100 min
    expect(planMinutesBetween(rows(), 50, 100)).toBeCloseTo(100, 6);
    expect(planMinutesBetween(rows(), 55, 100)).toBeCloseTo(90, 6);
  });

  it('is directional: a destination already behind you is zero, not negative', () => {
    // "time still to cover" only makes sense running forwards along the route
    expect(planMinutesBetween(rows(), 100, 50)).toBeCloseTo(0, 6);
    expect(planMinutesBetween(rows(), 120, 50)).toBeCloseTo(0, 6);
    expect(planMinutesBetween(rows(), 50, 20)).toBeCloseTo(0, 6);
    expect(planMinutesBetween(rows(), 50, 50)).toBeCloseTo(0, 6);
  });

  it('returns null without a usable plan', () => {
    expect(planMinutesBetween([], 0, 100)).toBeNull();
  });
});

/** Segments solved off `watt` for `secPerSeg` seconds each, `count` of them. */
function segs(count: number, watt: number, secPerSeg: number, stepKm = 2): Segment[] {
  return Array.from({ length: count }, (_, i) => ({
    i,
    distKm: stepKm * (i + 1),
    altM: 100,
    riseM: 0,
    gradePct: 0,
    vKph: 30,
    sec: secPerSeg,
    cumDistKm: stepKm * (i + 1),
    cumTimeSec: secPerSeg * (i + 1),
    powerLimited: false,
    powerUsedW: watt
  }));
}

describe('wPrimeSpentAt', () => {
  const FIT = { cp: 250, wPrime: 200000, r2: 0.98, points: 12, predicted: [] };

  it('spends nothing while riding exactly at CP', () => {
    expect(wPrimeSpentAt(segs(5, 250, 600), FIT, 10)).toBe(0);
  });

  it('spends work above CP and banks the deficit below it', () => {
    // 10 min at 300 W: 50 W surplus × 600 s = 30 kJ
    expect(wPrimeSpentAt(segs(1, 300, 600), FIT, 2)).toBeCloseTo(30000, 0);
    // 10 min at 200 W: 50 W under × 600 s = −30 kJ, which floors at zero spend
    expect(wPrimeSpentAt(segs(1, 200, 600), FIT, 2)).toBe(0);
    // 5 min above then 10 min below cancels out exactly
    expect(wPrimeSpentAt([...segs(1, 300, 300), ...segs(2, 200, 300)], FIT, 6)).toBeCloseTo(0, 0);
  });

  it('never banks more than the tank holds', () => {
    expect(wPrimeSpentAt(segs(3, 250, 1), FIT, 6)).toBe(0);
  });

  it('cannot be driven negative by a long descent', () => {
    expect(wPrimeSpentAt(segs(4, 100, 900), FIT, 8)).toBe(0);
  });

  it('stops at the requested distance rather than the end of the route', () => {
    // 50 W surplus per 600 s segment = 30 kJ each. Segments end at km 2/4/6/8, so asking
    // for km 4 admits the first two, and asking for the end admits all four.
    expect(wPrimeSpentAt(segs(4, 300, 600), FIT, 2)).toBeCloseTo(30000, 0);
    expect(wPrimeSpentAt(segs(4, 300, 600), FIT, 4)).toBeCloseTo(60000, 0);
    expect(wPrimeSpentAt(segs(4, 300, 600), FIT, 8)).toBeCloseTo(120000, 0);
  });

  it('cannot spend more than the tank holds, however long the climb runs', () => {
    // an hour of continuous 100 W surplus is 360 kJ, far past a 40 kJ tank
    expect(wPrimeSpentAt(segs(1, 350, 3600), FIT, 2)).toBe(FIT.wPrime);
  });

  it('is zero for a degenerate fit instead of dividing by zero', () => {
    expect(wPrimeSpentAt(segs(3, 300, 600), { ...FIT, cp: 0 }, 6)).toBe(0);
  });
});

describe('sustainAt', () => {
  const PHYSICS = { riderKg: 68, bikeKg: 9.4, cargoKg: 0, crr: 0.0045, cda: 0.32, temperatureC: 20 };
  /** 250 W CP with 40 kJ of W′. */
  const FIT = { cp: 250, wPrime: 40000, r2: 0.98, points: 12, predicted: [] };

  it('returns null without a usable plan', () => {
    expect(sustainAt([], 50, PHYSICS, FIT, 0, 600)).toBeNull();
  });

  it('still judges the gradient when there is no CP fit', () => {
    const p = sustainAt(rows(), 50, PHYSICS, undefined, 0, 600)!;
    expect(p.cp).toBeNull();
    expect(p.wPrimeLeft).toBeNull();
    expect(p.requiredW).toBeGreaterThan(0);
    expect(p.reason).toContain('No CP fit');
  });

  it('reports a pace below CP as sustainable indefinitely', () => {
    const p = sustainAt(rows(), 50, PHYSICS, FIT, 0, 600)!;
    expect(p.requiredW).toBeLessThan(p.sustainableW!);
    expect(p.sustainable).toBe(true);
    expect(p.reason).toContain('below CP');
  });

  it('leaves the tank untouched when nothing has been spent', () => {
    const p = sustainAt(rows(), 50, PHYSICS, FIT, 0, 600)!;
    expect(p.wPrimeLeft).toBe(FIT.wPrime);
    expect(p.wPrimePct).toBeCloseTo(1, 6);
  });

  it('draws the tank down as work above CP accumulates', () => {
    const half = sustainAt(rows(), 50, PHYSICS, FIT, FIT.wPrime / 2, 600)!;
    const most = sustainAt(rows(), 50, PHYSICS, FIT, FIT.wPrime * 0.95, 600)!;
    expect(half.wPrimeLeft!).toBeGreaterThan(most.wPrimeLeft!);
    expect(half.availableW!).toBeGreaterThan(most.availableW!);
    expect(half.wPrimePct!).toBeCloseTo(0.5, 2);
    expect(most.wPrimePct!).toBeCloseTo(0.05, 2);
  });

  it('clamps an overspend to an empty tank, not a negative one', () => {
    const p = sustainAt(rows(), 50, PHYSICS, FIT, FIT.wPrime * 3, 600)!;
    expect(p.wPrimeLeft).toBe(0);
    expect(p.wPrimePct).toBe(0);
    expect(p.availableW).toBe(p.sustainableW); // nothing left to borrow
  });

  it('ignores a negative spend rather than inventing reserve', () => {
    // recovery below CP fills the tank but cannot overfill it
    const p = sustainAt(rows(), 50, PHYSICS, FIT, -5000, 600)!;
    expect(p.wPrimeLeft).toBe(FIT.wPrime);
    expect(p.wPrimePct).toBeCloseTo(1, 6);
  });

  it('fails a wall once the tank is empty, but passes it fresh', () => {
    // the same wall, judged before and after the plan has drained W′
    const fresh = sustainAt(steepRows(), 4, PHYSICS, FIT, 0, 600)!;
    const spent = sustainAt(steepRows(), 4, PHYSICS, FIT, FIT.wPrime, 600)!;
    expect(fresh.requiredW).toBeGreaterThan(fresh.sustainableW!); // the wall is above CP
    expect(fresh.availableW!).toBeGreaterThan(fresh.sustainableW!); // W′ still contributing
    expect(fresh.sustainable).toBe(true);
    expect(spent.sustainable).toBe(false);
    expect(spent.reason).toContain('spent');
  });

  it('does not let even a fresh tank rescue an impossible gradient', () => {
    // A 2 kJ tank over a 600 s horizon buys ~3 W on top of CP, which cannot lift a wall
    // that costs hundreds. The reason distinguishes this from a *spent* tank.
    const p = sustainAt(steepRows(), 4, PHYSICS, { ...FIT, wPrime: 2000 }, 0, 600)!;
    expect(p.sustainable).toBe(false);
    expect(p.wPrimeLeft).toBe(2000);
    expect(p.reason).toContain('exceeds what the remaining W′ can buy');
  });

  it('scales the borrowed power with the horizon the pace must be held', () => {
    // The same full tank: a short burst can spend it on a big burst, a long haul cannot.
    // Without a horizon the reserve collapses to exactly CP regardless of its size, which
    // would let a tiny tank borrow as much as a large one.
    const burst = sustainAt(steepRows(), 4, PHYSICS, FIT, 0, 30)!;
    const haul = sustainAt(steepRows(), 4, PHYSICS, FIT, 0, 3600)!;
    expect(burst.availableW!).toBeGreaterThan(haul.availableW!);
    expect(haul.availableW! - haul.sustainableW!).toBeLessThan(burst.availableW! - burst.sustainableW!);
    // a small tank buys strictly less than a large one over the same horizon
    const small = sustainAt(steepRows(), 4, PHYSICS, { ...FIT, wPrime: 4000 }, 0, 600)!;
    const large = sustainAt(steepRows(), 4, PHYSICS, FIT, 0, 600)!;
    expect(small.availableW!).toBeLessThan(large.availableW!);
  });

  it('caps the borrow at the model horizon W′/CP, however absurd the tank', () => {
    // Over a 1 s window an enormous reserve would naively promise W'/1 s = 5 000 000 W.
    // The model's own horizon, W'/CP, bounds it instead.
    const huge = { ...FIT, wPrime: 5_000_000 };
    const burst = sustainAt(steepRows(), 4, PHYSICS, huge, 0, 1)!;
    const cap = huge.wPrime / huge.cp;
    expect(burst.availableW! - burst.sustainableW!).toBeLessThanOrEqual(cap);
    // over a realistic 10 min window the same reserve is spread as 5 000 000/600 = 8.3 kW,
    // which is the point: the *duration* is what makes a reserve meaningful, not its size
    const real = sustainAt(steepRows(), 4, PHYSICS, huge, 0, 600)!;
    expect(real.availableW! - real.sustainableW!).toBeCloseTo(Math.round(5_000_000 / 600), -2);
  });

  it('rejects a degenerate fit rather than dividing by zero', () => {
    for (const bad of [{ ...FIT, cp: 0 }, { ...FIT, wPrime: 0 }]) {
      const p = sustainAt(rows(), 50, PHYSICS, bad, 0, 600)!;
      expect(p.cp === null || p.sustainableW === null).toBe(true);
    }
  });
});

/**
 * A wall: a sustained +12 % solved down to a crawl. Holding any speed here costs far more
 * than CP, which is the only situation where W' actually decides the outcome.
 */
function steepRows(): PlanSeriesPoint[] {
  const kph = 10;
  return Array.from({ length: 6 }, (_, i) => ({
    km: i * 2,
    altM: 100 + i * 240, // +12 % over each 2 km
    gradePct: 12,
    kph,
    elapsedSec: i * ((2 / kph) * 3600),
    clockMin: 330 + i * ((2 / kph) * 60),
    powerLimited: true
  }));
}

describe('raceOutcome', () => {
  // 05:30 gun (330) planning a 6h47m finish -> 11:17 (677).
  const IN = { startMin: 330, plannedFinishMin: 677, actualFinishMin: 407 };

  it('reports how far the actual landed from the estimate', () => {
    const o = raceOutcome(IN)!;
    expect(o.planMin).toBe(347);
    expect(o.actualMin).toBe(407);
    expect(o.deltaMin).toBe(60);
    expect(o.deltaPct).toBeCloseTo(60 / 347, 6);
  });

  it('signs the delta so slower than promised reads positive', () => {
    // finished in 287 min against a 347 min plan
    expect(raceOutcome({ ...IN, actualFinishMin: 287 })!.deltaMin).toBe(-60);
    expect(raceOutcome(IN)!.deltaMin).toBeGreaterThan(0);
  });

  it('is null when either half was never recorded', () => {
    // A race finished before this existed: the rider pressed "Finish & save", so an actual
    // exists, but no baseline was ever written down.
    expect(raceOutcome({ ...IN, plannedFinishMin: null })).toBeNull();
    expect(raceOutcome({ ...IN, actualFinishMin: null })).toBeNull();
    expect(raceOutcome({ ...IN, plannedFinishMin: undefined })).toBeNull();
  });

  it('refuses a degenerate plan instead of dividing by zero', () => {
    expect(raceOutcome({ ...IN, plannedFinishMin: 330 })).toBeNull(); // 0 min plan
    expect(raceOutcome({ ...IN, plannedFinishMin: 200 })).toBeNull(); // finish before the gun
  });

  it('rejects non-finite values rather than propagating NaN', () => {
    expect(raceOutcome({ ...IN, actualFinishMin: NaN })).toBeNull();
    expect(raceOutcome({ ...IN, plannedFinishMin: Infinity })).toBeNull();
  });
});

describe('readoutOfOutcomes', () => {
  const at = (pct: number) => {
    const planMin = 100;
    return { planMin, actualMin: planMin * (1 + pct), deltaMin: planMin * pct, deltaPct: pct };
  };

  it('says nothing when no race carries a baseline', () => {
    const r = readoutOfOutcomes([{ name: 'a', at: 1, outcome: null }]);
    expect(r).toEqual({ compared: 0, medianDeltaPct: null, latest: null });
  });

  it('takes the median, so one wrecked race cannot swing the read', () => {
    const r = readoutOfOutcomes([
      { name: 'a', at: 1, outcome: at(0.02) },
      { name: 'b', at: 2, outcome: at(0.03) },
      { name: 'c', at: 3, outcome: at(0.04) },
      { name: 'flat', at: 4, outcome: at(1.5) } // wrecked halfway: a 150 % overrun
    ]);
    // median of [.02,.03,.04,1.5] is the mean of the two middle values
    expect(r.medianDeltaPct).toBeCloseTo(0.035, 6);
    expect(r.compared).toBe(4);
  });

  it('counts only races that can actually be compared', () => {
    const r = readoutOfOutcomes([
      { name: 'a', at: 1, outcome: at(0.05) },
      { name: 'b', at: 2, outcome: null }
    ]);
    expect(r.compared).toBe(1);
  });

  it('picks the newest comparable race, not the newest row', () => {
    const r = readoutOfOutcomes([
      { name: 'older', at: 10, outcome: at(0.05) },
      { name: 'newer', at: 20, outcome: at(0.09) },
      { name: 'newest but unmeasured', at: 30, outcome: null }
    ]);
    expect(r.latest!.name).toBe('newer');
  });
});
