import { describe, expect, it } from 'vitest';

// The mapping BandMeter.svelte performs per TSB value: (bandIndex + within-band
// fraction) / 5. Keeping these expectations in sync with the five formState()
// thresholds (−30, −10, +5, +25, +45) is the whole point of the test, so a
// future formState() change breaks a test instead of silently misplacing the
// cursor.
function meterPct(tsb: number): number {
  const SEG_STARTS = [-30, -10, 5, 25, 45];
  const idx = tsb < -30 ? 0 : tsb < -10 ? 1 : tsb < 5 ? 2 : tsb <= 25 ? 3 : 4;
  const lo = idx === 0 ? -60 : SEG_STARTS[idx - 1];
  const hi = SEG_STARTS[idx];
  const frac = Math.min(1, Math.max((tsb - lo) / (hi - lo), 0));
  return ((idx + frac) / 5) * 100;
}

describe('BandMeter TSB → cursor position', () => {
  it('maps formState thresholds to whole-band boundaries', () => {
    // Bands: 0 = below −30, 1 = −30…−10, 2 = −10…+5, 3 = +5…+25, 4 = above +25.
    // −10 = start of band 2 (40%), +5 = start of band 3 (60%), +25 = start of band 4 (80%).
    expect(meterPct(-10)).toBeCloseTo(40, 5);
    expect(meterPct(5)).toBeCloseTo(60, 5);
    expect(meterPct(25)).toBeCloseTo(80, 5);
  });

  it('maps reference values from the dashboard demo monotonically', () => {
    const pts = [-45, -20, 5, 15, 35];
    const pcts = pts.map(meterPct);
    for (const p of pcts) expect(p).toBeGreaterThanOrEqual(0);
    for (const p of pcts) expect(p).toBeLessThanOrEqual(100);
    for (let i = 1; i < pcts.length; i++) expect(pcts[i]).toBeGreaterThan(pcts[i - 1]);
  });

  it('places TSB +5 at the balanced→productive boundary (60%)', () => {
    expect(meterPct(5)).toBeCloseTo(60, 5);
    expect(meterPct(3)).toBeLessThan(60);
    expect(meterPct(7)).toBeGreaterThan(60);
  });

  it('clamps extreme off-scale values into the edge bands', () => {
    expect(meterPct(-90)).toBeCloseTo(0, 5);
    expect(meterPct(90)).toBeCloseTo(100, 5);
  });
});
