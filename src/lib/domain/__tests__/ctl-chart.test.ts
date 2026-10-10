import { describe, expect, it } from 'vitest';
import { buildCtlChart, CTL_CHART_H, type ChartPoint } from '../ctl-chart';

/** n points; ctl/atl from per-index functions (the chart only reads those two fields). */
const series = (n: number, ctl: (i: number) => number, atl: (i: number) => number = () => 0): ChartPoint[] =>
  Array.from({ length: n }, (_, i) => ({ ctl: ctl(i), atl: atl(i) }));

/** Every "x,y" pair out of a path string. */
const coords = (d: string): [number, number][] =>
  [...d.matchAll(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe('buildCtlChart', () => {
  it('needs at least two samples', () => {
    expect(buildCtlChart([])).toBeNull();
    expect(buildCtlChart(series(1, () => 100))).toBeNull();
    expect(buildCtlChart(series(2, (i) => i * 10))).not.toBeNull();
  });

  it('keeps every coordinate inside the canvas', () => {
    const c = buildCtlChart(series(85, (i) => 100 + i, (i) => 60 + i / 2))!;
    for (const d of [c.ctlPath, c.atlPath]) {
      for (const [px, py] of coords(d)) {
        expect(px).toBeGreaterThanOrEqual(0);
        expect(px).toBeLessThanOrEqual(c.W);
        // y(max) = H − 8 − (H − 20) = 12 … y(0) = H − 8 = 72
        expect(py).toBeGreaterThanOrEqual(12);
        expect(py).toBeLessThanOrEqual(c.H - 8);
      }
    }
  });

  it('spans the full width and shares x positions between the two lines', () => {
    const c = buildCtlChart(series(85, (i) => 100 + i, (i) => 50 + i))!;
    const ctlX = coords(c.ctlPath).map(([px]) => px);
    expect(ctlX[0]).toBe(0);
    expect(ctlX.at(-1)).toBe(c.W);
    expect(coords(c.atlPath).map(([px]) => px)).toEqual(ctlX);
  });

  it('downsamples a 12-week history to ~40 points but always ends on the last sample', () => {
    // ramp 0…84, atl flat 0 → max = 84 → the final CTL sits at y = 12
    const c = buildCtlChart(series(85, (i) => i))!;
    const pairs = coords(c.ctlPath);
    expect(pairs.length).toBeGreaterThan(2);
    expect(pairs.length).toBeLessThanOrEqual(44); // step 2 over 85 + the appended last
    expect(pairs.at(-1)).toEqual([c.W, 12]);
  });

  it('keeps every sample when the history is short', () => {
    const c = buildCtlChart(series(5, (i) => i * 10))!; // floor(5/40) = 0 → step 1
    expect(coords(c.ctlPath)).toHaveLength(5);
  });

  it('pins endY on the last drawn point of THIS series, at path precision', () => {
    // Regression: the dot used to be derived from the 90-day series while the chart drew
    // the 84-day one — different warm-up, different EMA, dot a hair off the line's end.
    const pts = series(85, (i) => 100 + Math.sin(i / 6) * 30, (i) => 40 + i / 4);
    const c = buildCtlChart(pts)!;
    const last = coords(c.ctlPath).at(-1)!;
    expect(last[0]).toBe(c.W);
    expect(c.endY).toBe(last[1]); // identical to the path's final y, 0.1 precision and all
    expect(c.endY).toBeGreaterThanOrEqual(12);
    expect(c.endY).toBeLessThanOrEqual(72);
  });

  it('measures the "+N over 8w" pill over 56 samples, rounded', () => {
    const c = buildCtlChart(series(85, (i) => 100 + i * 0.45))!;
    expect(c.ctlDelta).toBe(25); // 56 × 0.45 = 25.2 → 25
  });

  it('rounds the pill to whole points', () => {
    const pts = series(85, (i) => (i <= 28 ? 128.6 : i === 84 ? 184.4 : 150));
    expect(buildCtlChart(pts)!.ctlDelta).toBe(56); // 55.8 → 56
  });

  it('uses the whole series when it is shorter than 8 weeks', () => {
    expect(buildCtlChart(series(10, (i) => 100 + i * 3))!.ctlDelta).toBe(27); // 9 × 3
  });

  it('reports a negative pill while fitness is falling, and 0 when flat', () => {
    expect(buildCtlChart(series(85, (i) => 200 - i))!.ctlDelta).toBe(-56);
    expect(buildCtlChart(series(60, () => 140))!.ctlDelta).toBe(0);
  });

  it('renders an all-rest history without NaN and pins the dot at the baseline', () => {
    const c = buildCtlChart(series(85, () => 0, () => 0))!;
    expect(c.ctlPath).not.toMatch(/NaN|Infinity/);
    expect(c.atlPath).not.toMatch(/NaN|Infinity/);
    expect(c.endY).toBe(CTL_CHART_H - 8); // y(0) against the max = 1 floor
  });

  it('closes the area along the bottom edge', () => {
    const c = buildCtlChart(series(85, (i) => 100 + i))!;
    expect(c.area).toBe(`${c.ctlPath} L${c.W},${c.H} L0,${c.H} Z`);
  });
});
