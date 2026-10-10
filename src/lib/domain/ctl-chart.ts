/**
 * Hero CTL/ATL trend chart — pure geometry derivation.
 *
 * Extracted from Dashboard.svelte so the path building, the "+N over 8w" delta and the
 * end-dot position can be unit-tested without a component. Pure: takes the PMC series
 * and returns SVG path data — no clock, no DOM, no Dexie.
 *
 * Two details worth preserving, because both were live bugs before the extraction:
 * - `endY` comes from THIS series — the same points `ctlPath` draws. The dot used to be
 *   derived from the 90-day `pmc` while the chart drew the 84-day one: both end today,
 *   but different warm-up lengths give slightly different EMAs, and the dot sat a hair
 *   off the line's end. It also carries the path's 0.1 precision (`toFixed(1)`), so the
 *   dot lands exactly on the final coordinate rather than merely near it.
 * - `ctlDelta` measures 8 weeks (56 daily samples) back — the reference's window, NOT
 *   the full 12-week span — clamped to the series length for short histories.
 */

export interface ChartPoint {
  ctl: number;
  atl: number;
}

export interface CtlChart {
  /** SVG path data for the CTL line */
  ctlPath: string;
  /** SVG path data for the ATL line (dashed, behind) */
  atlPath: string;
  /** the CTL line closed down to the baseline */
  area: string;
  /** CTL change over the last 8 weeks, whole points — the "+N over 8w" pill */
  ctlDelta: number;
  /** Y of the last CTL point at path precision — where the end dot sits */
  endY: number;
  /** viewBox width */
  W: number;
  /** viewBox height */
  H: number;
}

export const CTL_CHART_W = 320;
export const CTL_CHART_H = 80;
/** the pill's window: 8 weeks of daily samples */
const DELTA_DAYS = 56;
/** downsample budget: at most ~40 plotted points per line */
const MAX_POINTS = 40;

export function buildCtlChart(
  pts: readonly ChartPoint[],
  W = CTL_CHART_W,
  H = CTL_CHART_H
): CtlChart | null {
  if (pts.length < 2) return null;

  const vals = pts.flatMap((p) => [p.ctl, p.atl]);
  const min = 0;
  const max = Math.max(...vals, 1); // floor of 1 so an all-rest history still divides
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - 8 - ((v - min) / (max - min)) * (H - 20);

  // Downsample to ~40 plotted points, always keeping the first and the last sample so
  // the line still spans the full width and ends on today's value.
  const step = Math.max(1, Math.floor(pts.length / MAX_POINTS));
  const idxs: number[] = [];
  for (let i = 0; i < pts.length; i += step) idxs.push(i);
  if (idxs.at(-1) !== pts.length - 1) idxs.push(pts.length - 1);

  const path = (key: keyof ChartPoint) =>
    idxs.map((i, k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pts[i][key]).toFixed(1)}`).join(' ');

  const ctlPath = path('ctl');
  const atlPath = path('atl');
  const area = `${ctlPath} L${W},${H} L0,${H} Z`;

  const back = Math.min(pts.length - 1, DELTA_DAYS);
  const ctlDelta = Math.round(pts.at(-1)!.ctl - pts.at(-1 - back)!.ctl);

  const endY = Number(y(pts.at(-1)!.ctl).toFixed(1));

  return { ctlPath, atlPath, area, ctlDelta, endY, W, H };
}
