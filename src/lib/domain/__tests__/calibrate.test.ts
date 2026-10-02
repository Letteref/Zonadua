import { describe, expect, it } from 'vitest';
import { buildCalibSamples, calibrate, type CalibSample, type CalibParams } from '../calibrate';

/**
 * Calibration tests.
 *
 * ## What this does and does not prove
 *
 * `syntheticRide` builds a ride by running the *same* forward model `calibrate` inverts.
 * So recovering the generating constants here proves the **least-squares solve is correct**
 * — that the 2×2 solve, the gravity subtraction and the power-at-the-pedals correction
 * all cancel out and hand back what went in. It does **not** prove the underlying physics
 * is correct; that is what `validation.test.ts` is for, against published numbers.
 *
 * Both halves matter and they are separate claims. A solver that cannot recover known
 * inputs is broken regardless of whether the model is right, and a correct solver over a
 * wrong model still returns confidently wrong numbers — which is why the second half
 * refuses so often.
 */

const MASS = 78; // 70 rider + 8 road bike
const RHO = 1.225;
const LOSS = 0.025;
const PARAMS: CalibParams = { riderKg: 70, bikeKg: 8, airDensity: RHO, drivetrainLoss: LOSS };

/** Deterministic noise so the tests never flake. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
}

interface RideOpts {
  crr: number;
  cda: number;
  km?: number;
  midKph?: number;
  ampKph?: number;
  /** metres of vertical over the whole ride */
  relief?: number;
  noise?: number;
  stepKm?: number;
}

/**
 * A ride ridden at a known `crr`/`cda`, built by running the physics model forwards and
 * emitting the pedal watts it would demand. Unrolling hills are included so the gravity
 * subtraction is actually exercised rather than being trivially zero.
 */
function syntheticRide(o: RideOpts): CalibSample[] {
  const { crr, cda, km = 40, midKph = 35, ampKph = 10, relief = 70, noise = 0.02, stepKm = 0.02 } = o;
  const rand = lcg(42);
  const g = 9.80665;
  const out: CalibSample[] = [];
  let t = 0;

  const elevAt = (d: number) => 100 + relief * Math.sin(d / 8);

  for (let d = 0; d <= km; d += stepKm) {
    const gradePct = ((elevAt(d + stepKm) - elevAt(d)) / (stepKm * 1000)) * 100;
    const kph = midKph + ampKph * Math.sin(d / 6);
    const v = kph / 3.6;
    const theta = Math.atan(gradePct / 100);

    const wheel =
      crr * MASS * g * Math.cos(theta) * v +
      MASS * g * Math.sin(theta) * v +
      0.5 * RHO * cda * v * v * v;
    const watts = (wheel / (1 - LOSS)) * (1 + (rand() - 0.5) * 2 * noise);

    out.push({ distKm: d, altM: elevAt(d), movingSec: t, watts });
    // km → m, divided by m/s, to get seconds.
    t += (stepKm * 1000) / (kph / 3.6);
  }
  return out;
}

describe('calibrate — recovers what went in', () => {
  it('recovers a road position and road tyres from an undulating ride', () => {
    const truth = { crr: 0.0052, cda: 0.31 };
    const result = calibrate(syntheticRide(truth), PARAMS);

    expect(result.ok, result.ok ? '' : result.reason).toBe(true);
    if (!result.ok) return;

    expect(result.crr).toBeCloseTo(truth.crr, 3);
    expect(result.cda).toBeCloseTo(truth.cda, 2);
    expect(result.rmsW).toBeLessThan(6);
  });

  it('recovers a tucked time-trial position, which has far less frontal area', () => {
    // The whole reason to measure rather than assume: 0.31 → 0.22 is a 30 % aero change,
    // and it is entirely invisible on the settings screen.
    const truth = { crr: 0.006, cda: 0.22 };
    const result = calibrate(syntheticRide(truth), PARAMS);
    expect(result.ok, result.ok ? '' : result.reason).toBe(true);
    if (!result.ok) return;
    expect(result.cda).toBeCloseTo(truth.cda, 2);
    expect(result.cda).toBeLessThan(0.25);
  });

  it('recovers deep-section wheels, which are worse on rolling resistance', () => {
    const truth = { crr: 0.0085, cda: 0.27 };
    const result = calibrate(syntheticRide(truth), PARAMS);
    expect(result.ok, result.ok ? '' : result.reason).toBe(true);
    if (!result.ok) return;
    expect(result.crr).toBeCloseTo(truth.crr, 3);
  });

  it('holds up with realistic measurement noise', () => {
    const truth = { crr: 0.005, cda: 0.32 };
    const result = calibrate(syntheticRide({ ...truth, noise: 0.05 }), PARAMS);
    expect(result.ok, result.ok ? '' : result.reason).toBe(true);
    if (!result.ok) return;
    expect(result.crr).toBeCloseTo(truth.crr, 2);
    expect(result.cda).toBeCloseTo(truth.cda, 1);
    // 5 % power noise is a lot; the fit should say so rather than pretend.
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('calibrate — refuses rather than guesses', () => {
  it('will not split rolling from aero on a ride held at one speed', () => {
    // Same speed the whole way: rolling and aero are then the same measurement in
    // different units, and any split of them fits the trace equally well.
    const result = calibrate(syntheticRide({ crr: 0.005, cda: 0.32, ampKph: 0.05 }), PARAMS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/cannot be separated/i);
    expect(result.detail).toMatch(/km\/h/);
  });

  it('refuses when there is too little ride to fit two parameters', () => {
    const short = syntheticRide({ crr: 0.005, cda: 0.32, km: 0.3 });
    const result = calibrate(short, PARAMS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/samples/i);
  });

  it('refuses a power trace that is plainly misaligned with the track', () => {
    // Watts scaled by a constant is not a plausible drag coefficient change — the ride is
    // being ridden at the right speed with the wrong amount of power, which is what a
    // time-sync failure looks like.
    const ride = syntheticRide({ crr: 0.005, cda: 0.32 }).map((s) => ({ ...s, watts: s.watts * 3 }));
    const result = calibrate(ride, PARAMS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/not physically possible/i);
  });

  it('never returns a number it cannot defend', () => {
    // Anything the solver does return must sit inside the range real riders occupy.
    for (const truth of [
      { crr: 0.003, cda: 0.26 },
      { crr: 0.004, cda: 0.38 },
      { crr: 0.009, cda: 0.24 }
    ]) {
      const r = calibrate(syntheticRide(truth), PARAMS);
      if (!r.ok) continue;
      expect(r.crr).toBeGreaterThanOrEqual(0.002);
      expect(r.crr).toBeLessThanOrEqual(0.012);
      expect(r.cda).toBeGreaterThanOrEqual(0.15);
      expect(r.cda).toBeLessThanOrEqual(0.6);
      expect(Number.isFinite(r.rmsW)).toBe(true);
    }
  });

  it('always states that wind was assumed, not measured', () => {
    const result = calibrate(syntheticRide({ crr: 0.005, cda: 0.32 }), PARAMS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(' ')).toMatch(/wind/i);
  });
});

describe('buildCalibSamples', () => {
  const points = Array.from({ length: 400 }, (_, i) => ({
    t: 1_700_000_000_000 + i * 5000,
    lat: -0.5 + i * 0.0001,
    lng: 100.3,
    alt: 100,
    watts: 200 + (i % 20)
  }));

  it('turns stored points into distance, time and smoothed power', () => {
    const samples = buildCalibSamples(points, 5);
    expect(samples.length).toBe(points.length);
    expect(samples[0].distKm).toBe(0);
    expect(samples.at(-1)!.distKm).toBeGreaterThan(3);
    expect(samples.at(-1)!.movingSec).toBeCloseTo(399 * 5, 0);

    // The moving average must actually smooth: no sample may sit far from the local mean.
    for (let i = 5; i < samples.length - 5; i++) {
      const window = samples.slice(i - 3, i + 4);
      const mean = window.reduce((a, s) => a + s.watts, 0) / window.length;
      expect(Math.abs(samples[i].watts - mean)).toBeLessThan(3);
    }
  });

  it('drops points with no power reading instead of reading them as zero watts', () => {
    // A meter paired halfway through costs half the ride; zero-filling would invent a
    // coast through the first half and pull Crr down with it.
    const halfPaired = points.map((p, i) => (i < 200 ? { ...p, watts: undefined } : p));
    const samples = buildCalibSamples(halfPaired as never, 5);
    expect(samples.length).toBe(200);
    expect(samples.every((s) => s.watts > 0)).toBe(true);
  });

  it('returns nothing rather than guessing when the track is too short', () => {
    expect(buildCalibSamples(points.slice(0, 10), 5)).toEqual([]);
  });
});