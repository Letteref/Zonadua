import { describe, expect, it } from 'vitest';
import { buildPlan, fitIfForAvgSpeed } from '../pacing';
import type { ProfilePoint } from '../physics';

const PHYSICS = {
  riderKg: 68,
  bikeKg: 9.4,
  crr: 0.0045,
  cda: 0.32,
  airDensity: 1.225,
  drivetrainLoss: 0.025
};

/** The same rolling-to-summit profile the pacing suite plans against. */
const profile: ProfilePoint[] = [
  { distKm: 0, altM: 145 },
  { distKm: 50, altM: 140 },
  { distKm: 100, altM: 128 },
  { distKm: 140, altM: 700 },
  { distKm: 174, altM: 1450 },
  { distKm: 200, altM: 150 }
];

const planAt = (ifTarget: number, ftp = 275) =>
  buildPlan({
    profile,
    physics: PHYSICS,
    pacing: { mode: 'if', ifTarget, ftp },
    stops: { count: 3, minutesEach: 10 },
    startMin: 5 * 60 + 30
  });

describe('fitIfForAvgSpeed', () => {
  it('recovers the intensity that produced a given average speed', () => {
    const target = planAt(0.7).avgKph ?? 0;
    expect(target).toBeGreaterThan(0);

    const fit = fitIfForAvgSpeed((ift) => planAt(ift), target);

    expect(fit.reachable).toBe(true);
    expect(fit.note).toBeNull();
    expect(fit.ifTarget).toBeCloseTo(0.7, 1);
    expect(fit.avgKph).toBeCloseTo(target, 1);
  });

  it('reports a target beyond what the setup can produce instead of clamping quietly', () => {
    const fit = fitIfForAvgSpeed((ift) => planAt(ift), 200);

    expect(fit.reachable).toBe(false);
    expect(fit.note).toMatch(/tops out/);
  });

  it('reports a target slower than the easiest solve as unreachable too', () => {
    const fit = fitIfForAvgSpeed((ift) => planAt(ift), 2);

    expect(fit.reachable).toBe(false);
    expect(fit.note).toMatch(/easiest pace/);
  });

  it('says so when there is no power model to pace by', () => {
    const fit = fitIfForAvgSpeed((ift) => planAt(ift, 0), 30);

    expect(fit.reachable).toBe(false);
    expect(fit.note).toMatch(/FTP/);
  });
});
