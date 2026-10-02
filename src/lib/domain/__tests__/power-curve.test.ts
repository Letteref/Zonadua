import { describe, expect, it } from 'vitest';
import {
  CURVE_DURATIONS_SEC,
  FIT_MIN_DURATION_SEC,
  curveValueAt,
  fitCriticalPower,
  meanMaxPower,
  mergePowerCurves,
  wPrimeExhaustionTime,
  wPrimeRemaining
} from '../power-curve';

const constant = (watts: number, sec: number): number[] => new Array(sec).fill(watts);
const step = (a: number, aSec: number, b: number, bSec: number): number[] => [
  ...constant(a, aSec),
  ...constant(b, bSec)
];

describe('meanMaxPower', () => {
  it('reports the steady power for every duration the ride can hold', () => {
    const curve = meanMaxPower(constant(250, 7200), 1, [60, 300, 600]);
    expect(curve).toEqual([
      { durationSec: 60, watts: 250 },
      { durationSec: 300, watts: 250 },
      { durationSec: 600, watts: 250 }
    ]);
  });

  it('averages across the window, so a step drops with duration', () => {
    // 600 s at 100 W then 600 s at 300 W
    const curve = meanMaxPower(step(100, 600, 300, 600), 1, [60, 600, 1200]);
    expect(curve).toEqual([
      { durationSec: 60, watts: 300 },
      { durationSec: 600, watts: 300 }, // the 300 W half sits entirely inside this window
      { durationSec: 1200, watts: 200 } // the whole ride averaged out
    ]);
  });

  it('skips durations longer than the ride', () => {
    const curve = meanMaxPower(constant(200, 300), 1, [60, 600]);
    expect(curve).toEqual([{ durationSec: 60, watts: 200 }]);
  });

  it('slides the window to capture the best section', () => {
    // 60 s at 100 W then 60 s at 300 W. A 90 s window has 31 legal placements;
    // the best one ends with the trace: 30 × 100 W + 60 × 300 W = 21 000 Ws / 90 = 233 W.
    expect(meanMaxPower(step(100, 60, 300, 60), 1, [90])).toEqual([
      { durationSec: 90, watts: 233 }
    ]);
  });

  it('rejects a duration that would need a partial trailing window', () => {
    // 120 samples cannot hold 121 s — no window qualifies, so no point is emitted
    expect(meanMaxPower(step(100, 60, 300, 60), 1, [121])).toEqual([]);
  });

  it('honours the sampling interval', () => {
    // 120 samples × 5 s = 600 s of 200 W; a 300 s window is 60 samples
    const curve = meanMaxPower(constant(200, 120), 5, [300, 900]);
    expect(curve).toEqual([{ durationSec: 300, watts: 200 }]);
  });

  it('clamps negative (regen) samples', () => {
    expect(meanMaxPower(constant(-300, 600), 1, [60])).toEqual([{ durationSec: 60, watts: 0 }]);
  });

  it('returns nothing for an empty trace', () => {
    expect(meanMaxPower([], 1, [60])).toEqual([]);
  });

  it('handles a realistic trace length in reasonable time', () => {
    const trace = new Array(2160).fill(0).map((_, i) => 200 + Math.sin(i / 40) * 60);
    const start = performance.now();
    const curve = meanMaxPower(trace, 5, CURVE_DURATIONS_SEC);
    expect(curve.length).toBeGreaterThan(20);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('mergePowerCurves', () => {
  it('keeps the best value per duration', () => {
    const merged = mergePowerCurves([
      [
        { durationSec: 60, watts: 210 },
        { durationSec: 300, watts: 240 }
      ],
      [
        { durationSec: 60, watts: 265 },
        { durationSec: 300, watts: 198 }
      ]
    ]);
    expect(merged).toEqual([
      { durationSec: 60, watts: 265 },
      { durationSec: 300, watts: 240 }
    ]);
  });

  it('sorts by duration regardless of input order', () => {
    const merged = mergePowerCurves([
      [{ durationSec: 600, watts: 200 }],
      [{ durationSec: 60, watts: 300 }]
    ]);
    expect(merged.map((p) => p.durationSec)).toEqual([60, 600]);
  });

  it('keeps durations that only one activity covered', () => {
    const merged = mergePowerCurves([[{ durationSec: 60, watts: 200 }], [{ durationSec: 1200, watts: 180 }]]);
    expect(merged).toHaveLength(2);
  });

  it('ignores empty input', () => {
    expect(mergePowerCurves([])).toEqual([]);
    expect(mergePowerCurves([[], []])).toEqual([]);
  });
});

describe('fitCriticalPower', () => {
  /** Build a curve straight from the model so the fit has a known answer. */
  const modelCurve = (cp: number, wPrime: number, durations = [120, 180, 300, 600, 1200, 2400, 3600]) =>
    durations.map((durationSec) => ({ durationSec, watts: cp + wPrime / durationSec }));

  it('recovers exact parameters from an ideal model curve', () => {
    const fit = fitCriticalPower(modelCurve(260, 20000))!;
    expect(fit).toBeDefined();
    expect(fit.cp).toBeCloseTo(260, 0);
    expect(fit.wPrime).toBeCloseTo(20000, -2);
    expect(fit.r2).toBeGreaterThan(0.999);
  });

  it('stays accurate with 3% multiplicative noise (R² > 0.95)', () => {
    const curve = modelCurve(275, 18000).map((p, i) => ({
      durationSec: p.durationSec,
      watts: p.watts * (1 + (i % 2 === 0 ? 0.03 : -0.03))
    }));
    const fit = fitCriticalPower(curve)!;
    expect(fit.r2).toBeGreaterThan(0.95);
    expect(Math.abs(fit.cp - 275)).toBeLessThan(275 * 0.1);
    expect(fit.wPrime).toBeGreaterThan(0);
  });

  it('honours an outlier-free CP near the short-duration asymptote', () => {
    const fit = fitCriticalPower(modelCurve(180, 12000))!;
    expect(fit.cp).toBeCloseTo(180, 0);
  });

  it('excludes sub-2-minute efforts from the fit', () => {
    const curve = [...modelCurve(260, 20000, [1, 5, 30]), ...modelCurve(260, 20000, [120, 600, 1800])];
    const fit = fitCriticalPower(curve)!;
    expect(fit.points).toBe(3);
    expect(fit.cp).toBeCloseTo(260, 0);
  });

  it('refuses to fit when there are too few usable points', () => {
    expect(fitCriticalPower([{ durationSec: 60, watts: 300 }])).toBeUndefined();
    expect(
      fitCriticalPower([
        { durationSec: 60, watts: 300 },
        { durationSec: 90, watts: 280 },
        { durationSec: 110, watts: 270 }
      ])
    ).toBeUndefined();
  });

  it('never returns negative parameters even for a flat curve', () => {
    const fit = fitCriticalPower([
      { durationSec: 120, watts: 200 },
      { durationSec: 300, watts: 200 },
      { durationSec: 600, watts: 200 },
      { durationSec: 1800, watts: 200 }
    ])!;
    expect(fit.cp).toBeGreaterThan(0);
    expect(fit.wPrime).toBeGreaterThan(0);
    expect(fit.r2).toBeGreaterThanOrEqual(0);
  });

  it('is order-independent', () => {
    const curve = modelCurve(260, 20000);
    expect(fitCriticalPower(curve)).toEqual(fitCriticalPower([...curve].reverse()));
  });

  it('reports predictions aligned with the fitted points', () => {
    const curve = modelCurve(260, 20000);
    const fit = fitCriticalPower(curve)!;
    expect(fit.predicted).toHaveLength(curve.length);
    expect(fit.predicted[0].durationSec).toBe(curve[0].durationSec);
    expect(fit.predicted.at(-1)!.watts).toBeLessThan(fit.predicted[0].watts);
  });

  it('is not fooled by very short efforts', () => {
    // a 1-second sprint sits far above CP and must not drag the asymptote up with it
    const curve = [
      { durationSec: 1, watts: 1400 },
      ...modelCurve(260, 20000, [300, 600, 1200, 2400])
    ];
    const fit = fitCriticalPower(curve)!;
    expect(fit.cp).toBeCloseTo(260, 0);
  });

  it('uses durations from 2 minutes upward for fitting', () => {
    expect(FIT_MIN_DURATION_SEC).toBe(120);
  });
});

describe('W′ model helpers', () => {
  const fit = { cp: 250, wPrime: 20000, r2: 1, points: 5, predicted: [] };

  it('exhausts W′ at t = W′/CP', () => {
    expect(wPrimeExhaustionTime(fit)).toBeCloseTo(80, 6);
  });

  it('decays the pool linearly to zero', () => {
    expect(wPrimeRemaining(fit, 0)).toBeCloseTo(20000, 6);
    expect(wPrimeRemaining(fit, 40)).toBeCloseTo(10000, 6);
    expect(wPrimeRemaining(fit, 80)).toBe(0);
    expect(wPrimeRemaining(fit, 600)).toBe(0);
  });

  it('is safe with a degenerate CP', () => {
    expect(wPrimeExhaustionTime({ ...fit, cp: 0 })).toBe(0);
    expect(wPrimeRemaining({ ...fit, cp: 0 }, 10)).toBe(0);
  });
});

describe('curveValueAt', () => {
  const curve = [
    { durationSec: 60, watts: 300 },
    { durationSec: 300, watts: 240 },
    { durationSec: 600, watts: 200 }
  ];

  it('interpolates between points', () => {
    expect(curveValueAt(curve, 180)).toBe(270);
  });

  it('clamps outside the measured range', () => {
    expect(curveValueAt(curve, 10)).toBe(300);
    expect(curveValueAt(curve, 5000)).toBe(200);
  });

  it('returns exact values at the measured points', () => {
    expect(curveValueAt(curve, 300)).toBe(240);
  });

  it('returns undefined for an empty curve', () => {
    expect(curveValueAt([], 60)).toBeUndefined();
  });
});