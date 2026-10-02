import { describe, expect, it } from 'vitest';
import {
  ftpOnDate,
  intensityFactor,
  kjToKcal,
  kilojoules,
  normalizedPower,
  rideMetrics,
  trainingStressScore
} from '../metrics';

/** Constant power trace: one sample per second. */
const constant = (watts: number, sec: number): number[] => new Array(sec).fill(watts);

/** 1 s alternation — the canonical NP probe. */
const alternate = (a: number, b: number, sec: number): number[] =>
  new Array(sec).fill(0).map((_, i) => (i % 2 === 0 ? a : b));

/**
 * Independent reference implementation: no rolling sum, just recompute each window.
 * Used to cross-check the O(n) implementation on traces with no closed form.
 */
function naiveNp(watts: readonly number[], win = 30): number {
  const n = watts.length;
  if (n === 0) return 0;
  const w = Math.min(win, n);
  let sum4 = 0;
  for (let s = 0; s + w <= n; s++) {
    let acc = 0;
    for (let i = s; i < s + w; i++) acc += Math.max(0, watts[i]);
    sum4 += (acc / w) ** 4;
  }
  return (sum4 / (n - w + 1)) ** 0.25;
}

describe('normalizedPower', () => {
  it('returns the input power for a perfectly steady hour', () => {
    expect(normalizedPower(constant(200, 3600))).toBeCloseTo(200, 6);
  });

  it('ignores variability in a 1 s on/off pattern (window mean is flat)', () => {
    // 15 × 100 W + 15 × 300 W per 30 s window → mean 200 W → NP exactly 200 W
    expect(normalizedPower(alternate(100, 300, 3600))).toBeCloseTo(200, 6);
  });

  it('penalises two-block variability above the arithmetic mean', () => {
    const trace = [...constant(300, 1800), ...constant(100, 1800)];
    const np = normalizedPower(trace);
    const arithmeticMean = 200;
    expect(np).toBeGreaterThan(arithmeticMean);
    expect(np).toBeLessThan(300);
    // matches the naive window-by-window reference
    expect(np).toBeCloseTo(naiveNp(trace), 9);
  });

  it('matches the naive reference on a pseudo-random trace', () => {
    // deterministic LCG so the test never flakes
    let seed = 12345;
    const trace = new Array(4000).fill(0).map(() => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return (seed % 420) + 40;
    });
    expect(normalizedPower(trace)).toBeCloseTo(naiveNp(trace), 9);
  });

  it('honours the sample interval (15 s sampling over an hour)', () => {
    // 240 samples × 15 s = 3600 s of steady 200 W; 30 s window = 2 samples
    expect(normalizedPower(constant(200, 240), 15)).toBeCloseTo(200, 6);
  });

  it('collapses rides shorter than the window to a single whole-ride window', () => {
    // one window ⇒ NP is the plain mean power, no variability penalty is measurable
    expect(normalizedPower(constant(250, 20))).toBeCloseTo(250, 6);
    expect(normalizedPower(constant(180, 29))).toBeCloseTo(180, 6);
  });

  it('clamps negative (regen) samples to zero', () => {
    expect(normalizedPower(constant(-100, 600))).toBe(0);
    // half the samples negative: the clamped mean is 100 W, and the two-block shape
    // means NP sits above that mean — but never below it and never above 200 W
    const trace = [...constant(200, 300), ...constant(-200, 300)];
    const np = normalizedPower(trace);
    expect(np).toBeGreaterThan(100);
    expect(np).toBeLessThan(200);
  });

  it('is safe on empty and non-finite input', () => {
    expect(normalizedPower([])).toBe(0);
    // NaN and Infinity both count as zero-power samples, so the 3-sample ride
    // collapses to a single window averaging just the one valid 100 W sample
    expect(normalizedPower([Number.NaN, 100, Number.POSITIVE_INFINITY])).toBeCloseTo(100 / 3, 6);
  });
});

describe('intensityFactor / trainingStressScore', () => {
  it('computes IF against the given FTP', () => {
    expect(intensityFactor(200, 250)).toBeCloseTo(0.8, 10);
  });

  it('never divides by an unknown FTP', () => {
    expect(intensityFactor(200, 0)).toBe(0);
    expect(intensityFactor(200, -10)).toBe(0);
  });

  it('scores an hour at IF 0.8 as 64 TSS', () => {
    expect(trainingStressScore(1, 0.8)).toBeCloseTo(64, 10);
  });

  it('scores an hour at FTP as 100 TSS', () => {
    expect(trainingStressScore(1, 1)).toBeCloseTo(100, 10);
  });

  it('returns 0 for empty or non-positive input', () => {
    expect(trainingStressScore(0, 0.8)).toBe(0);
    expect(trainingStressScore(1, 0)).toBe(0);
  });
});

describe('work and energy', () => {
  it('computes 720 kJ for an hour at 200 W', () => {
    expect(kilojoules(constant(200, 3600))).toBeCloseTo(720, 6);
  });

  it('converts kJ to kcal at 4.184 kJ per kcal', () => {
    expect(kjToKcal(720)).toBeCloseTo(172.084, 3);
    expect(kjToKcal(0)).toBe(0);
  });
});

describe('ftpOnDate', () => {
  const history = [
    { date: '2026-01-01', ftp: 250 },
    { date: '2026-05-01', ftp: 275 },
    { date: '2026-09-01', ftp: 290 }
  ];

  it('resolves the value in force on a date', () => {
    expect(ftpOnDate(history, '2026-03-15')).toBe(250);
    expect(ftpOnDate(history, '2026-07-01')).toBe(275);
  });

  it('is inclusive on the measurement date', () => {
    expect(ftpOnDate(history, '2026-05-01')).toBe(275);
  });

  it('accepts a full ISO datetime', () => {
    expect(ftpOnDate(history, '2026-07-01T06:30:00.000Z')).toBe(275);
  });

  it('falls back to the earliest value before the history starts', () => {
    expect(ftpOnDate(history, '2025-12-01')).toBe(250);
  });

  it('is order-independent', () => {
    const shuffled = [history[2], history[0], history[1]];
    expect(ftpOnDate(shuffled, '2026-07-01')).toBe(275);
  });

  it('returns 0 for an empty history', () => {
    expect(ftpOnDate([], '2026-07-01')).toBe(0);
  });
});

describe('FTP sensitivity (why retro-compute is needed)', () => {
  const trace = constant(250, 3600);
  const history = [
    { date: '2026-01-01', ftp: 250 },
    { date: '2026-10-01', ftp: 300 }
  ];

  it('scales IF and TSS by the FTP in force, leaving NP untouched', () => {
    const before = rideMetrics(trace, ftpOnDate(history, '2026-06-01'));
    const after = rideMetrics(trace, ftpOnDate(history, '2026-10-02'));

    expect(after.np).toBe(before.np); // NP is a property of the power trace alone
    expect(after.if).toBeCloseTo(before.if * (250 / 300), 6);
    expect(after.tss).toBeCloseTo(before.tss * (250 / 300) ** 2, 6);
  });

  it('actually rescoring a ride changes its training load', () => {
    const before = rideMetrics(trace, 250).tss;
    const after = rideMetrics(trace, 300).tss;
    expect(after).toBeLessThan(before);
    expect(Math.round(before)).toBe(100); // 1 h at FTP
    expect(Math.round(after)).toBe(69); // 1 h at 250 W against a 300 W FTP
  });
});

describe('rideMetrics', () => {
  it('produces the full set for one steady hour at 200 W against 250 W FTP', () => {
    const m = rideMetrics(constant(200, 3600), 250);
    expect(m.np).toBeCloseTo(200, 6);
    expect(m.if).toBeCloseTo(0.8, 10);
    expect(m.tss).toBeCloseTo(64, 6);
    expect(m.kj).toBeCloseTo(720, 6);
    expect(m.kcal).toBeCloseTo(172.084, 2);
    expect(m.avgPower).toBe(200);
    expect(m.maxPower).toBe(200);
    expect(m.ftp).toBe(250);
  });

  it('scores an interval session harder than the same mean power held steady', () => {
    const steady = rideMetrics(constant(200, 3600), 250);
    const variable = rideMetrics([...constant(300, 1800), ...constant(100, 1800)], 250);
    expect(variable.tss).toBeGreaterThan(steady.tss);
  });

  it('degrades gracefully without FTP', () => {
    const m = rideMetrics(constant(200, 3600), 0);
    expect(m.np).toBeCloseTo(200, 6);
    expect(m.if).toBe(0);
    expect(m.tss).toBe(0);
  });

  it('uses elapsed time, not sample count, for TSS', () => {
    // 600 samples at 6 s spacing = 3600 s of riding
    const m = rideMetrics(constant(200, 600), 250, 6);
    expect(m.tss).toBeCloseTo(64, 6);
  });
});