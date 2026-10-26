import { describe, expect, it } from 'vitest';
import {
  CURVE_DURATIONS_SEC,
  FIT_MIN_DURATION_SEC,
  CP_FROM_FTP_RATIO,
  DEFAULT_RIDER_WEIGHT_KG,
  W_PRIME_MAX_J,
  W_PRIME_MIN_J,
  curveValueAt,
  estimateCpWFromFtp,
  estimateWPrimeFromBody,
  fitCriticalPower,
  meanMaxPower,
  mergePowerCurves,
  resolveCpFit,
  wPrimeExhaustionTime,
  wPrimeRemaining,
  type CurvePoint
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

describe('resolveCpFit — measured beats typed, typed beats nothing', () => {
  /** A hyperbolic curve the two-parameter model fits cleanly: CP 250 W, W′ 20 kJ. */
  const modelCurve = (cp = 250, wPrime = 20000): CurvePoint[] =>
    [180, 300, 600, 1200, 3600].map((durationSec) => ({
      durationSec,
      watts: Math.round(cp + wPrime / durationSec)
    }));

  const ENTERED = { cp: 231, wPrime: 13200 };

  it('says nothing at all when there is neither a curve nor a typed pair', () => {
    expect(resolveCpFit([])).toBeUndefined();
    expect(resolveCpFit([], undefined)).toBeUndefined();
  });

  it('judges on the typed pair when no curve exists, and marks it as entered', () => {
    const out = resolveCpFit([], ENTERED)!;
    expect(out.source).toBe('entered');
    expect(out.fit.cp).toBe(231);
    expect(out.fit.wPrime).toBe(13200);
    // nothing downstream may read a typed pair as evidence of a fit
    expect(out.fit.points).toBe(0);
    expect(out.fit.r2).toBe(0);
    expect(out.fit.predicted).toEqual([]);
  });

  it("prefers the rider's own rides over a number they typed", () => {
    const out = resolveCpFit([modelCurve()], ENTERED)!;
    expect(out.source).toBe('measured');
    expect(out.fit.points).toBe(5);
    expect(out.fit.cp).toBeGreaterThan(240);
    expect(out.fit.cp).toBeLessThan(260);
    expect(out.fit.wPrime).toBeGreaterThan(15000);
    expect(out.fit.wPrime).toBeLessThan(25000);
  });

  it('falls back to the typed pair when the curve is too thin to fit', () => {
    // two durations cannot identify two parameters, so a "fit" here would be invented
    const thin: CurvePoint[] = [
      { durationSec: 180, watts: 361 },
      { durationSec: 600, watts: 283 }
    ];
    expect(resolveCpFit([thin])).toBeUndefined();
    const out = resolveCpFit([thin], ENTERED)!;
    expect(out.source).toBe('entered');
    expect(out.fit.cp).toBe(231);
  });

  it('refuses half a pair — a CP with no W′ cannot judge a ride', () => {
    expect(resolveCpFit([], { cp: 231, wPrime: 0 })).toBeUndefined();
    expect(resolveCpFit([], { cp: 0, wPrime: 13200 })).toBeUndefined();
    expect(resolveCpFit([], { cp: -5, wPrime: 13200 })).toBeUndefined();
  });
});

describe('estimateWPrimeFromBody — W′ tracks kilos and training, not one constant', () => {
  it('gives a heavier rider a bigger tank at the same tier', () => {
    const light = estimateWPrimeFromBody(60, 'structured');
    const heavy = estimateWPrimeFromBody(85, 'structured');
    expect(heavy).toBeGreaterThan(light);
    // 210 J/kg: 60 kg → 12.6 kJ, 85 kg → 17.85 → 17.9 kJ
    expect(light).toBe(12_600);
    expect(heavy).toBe(17_900);
  });

  it('gives a more trained rider a bigger tank at the same weight', () => {
    // 170 / 210 / 250 J/kg at 68 kg
    expect(estimateWPrimeFromBody(68, 'foundation')).toBe(11_600);
    expect(estimateWPrimeFromBody(68, 'structured')).toBe(14_300);
    expect(estimateWPrimeFromBody(68, 'performance')).toBe(17_000);
  });

  it('rounds to the nearest 100 J — W′ is not a figure anyone measures to the joule', () => {
    // 210 × 68.2 = 14322 → 14300
    expect(estimateWPrimeFromBody(68.2, 'structured')).toBe(14_300);
  });

  it('falls back to the middle tier for a missing or unknown archetype', () => {
    expect(estimateWPrimeFromBody(70, undefined)).toBe(estimateWPrimeFromBody(70, 'structured'));
    expect(estimateWPrimeFromBody(70, 'nonsense')).toBe(estimateWPrimeFromBody(70, 'structured'));
  });

  it('assumes a mid-size rider when there is no usable weight', () => {
    const assumed = estimateWPrimeFromBody(undefined, 'structured');
    expect(assumed).toBe(estimateWPrimeFromBody(DEFAULT_RIDER_WEIGHT_KG, 'structured'));
    expect(estimateWPrimeFromBody(0, 'structured')).toBe(assumed);
    expect(estimateWPrimeFromBody(-68, 'structured')).toBe(assumed);
    expect(estimateWPrimeFromBody(Number.NaN, 'structured')).toBe(assumed);
  });

  it('stays inside the band real riders occupy', () => {
    // 170 J/kg × 40 kg = 6.8 kJ, below anything a human races on
    expect(estimateWPrimeFromBody(40, 'foundation')).toBe(W_PRIME_MIN_J);
    // 250 J/kg × 120 kg = 30 kJ, above the largest credible tank
    expect(estimateWPrimeFromBody(120, 'performance')).toBe(W_PRIME_MAX_J);
  });
});

describe('estimateCpWFromFtp — a starting pair for the rider with no meter', () => {
  it('scales both halves: CP off FTP, W′ off body and tier', () => {
    const est = estimateCpWFromFtp(275, { weightKg: 68.2, archetype: 'structured' })!;
    expect(est.cp).toBe(261);
    expect(est.wPrime).toBe(14_300);
    expect(est.weightKg).toBe(68.2);
    expect(est.weightAssumed).toBe(false);
    expect(est.archetype).toBe('structured');
    expect(CP_FROM_FTP_RATIO).toBe(0.95);
  });

  it('changes W′ with the tier while CP stays the same', () => {
    const base = estimateCpWFromFtp(275, { weightKg: 68.2, archetype: 'structured' })!;
    const racer = estimateCpWFromFtp(275, { weightKg: 68.2, archetype: 'performance' })!;
    expect(racer.cp).toBe(base.cp);
    expect(racer.wPrime).toBeGreaterThan(base.wPrime);
    expect(racer.wPrime).toBe(17_100); // 250 × 68.2 = 17050 → 17100
  });

  it('says out loud when the body mass was assumed', () => {
    const est = estimateCpWFromFtp(275)!;
    expect(est.weightAssumed).toBe(true);
    expect(est.weightKg).toBe(DEFAULT_RIDER_WEIGHT_KG);
    expect(est.wPrime).toBe(estimateWPrimeFromBody(DEFAULT_RIDER_WEIGHT_KG, 'structured'));
  });

  it('rounds CP to whole watts — a fraction of a watt is not a number to ride to', () => {
    // 231 × 0.95 = 219.45 → 219; 233 × 0.95 = 221.35 → 221
    expect(estimateCpWFromFtp(231)!.cp).toBe(219);
    expect(estimateCpWFromFtp(233)!.cp).toBe(221);
  });

  it('offers no estimate when there is no FTP to work from', () => {
    expect(estimateCpWFromFtp(undefined)).toBeUndefined();
    expect(estimateCpWFromFtp(null)).toBeUndefined();
    expect(estimateCpWFromFtp(0)).toBeUndefined();
    expect(estimateCpWFromFtp(-275)).toBeUndefined();
    expect(estimateCpWFromFtp(Number.NaN)).toBeUndefined();
    expect(estimateCpWFromFtp(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});