import { describe, expect, it } from 'vitest';
import {
  AMAN_MIN,
  clockAtKm,
  feasibility,
  gateBufferAt,
  kmAtClock,
  lastGatePassed,
  planMinutesBetween
} from '../race';
import type { PlanSeriesPoint } from '../pacing';

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
