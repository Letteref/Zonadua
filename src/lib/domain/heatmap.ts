/**
 * 16-week training heatmap + weekly TSS bars — pure domain derivation.
 *
 * Extracted from Dashboard.svelte so the grid and the bars can be unit-tested without a
 * component or a database. Pure and deterministic: `now` is injectable for tests.
 *
 * ## One calendar, two views
 * The grid and the bars describe the SAME 16 calendar weeks, so they can never disagree:
 * `sum(weeks) === sum(cells)`, and bar `Wn` is exactly column `n`'s total.
 *
 * - **Grid**: 16 columns × 7 rows, column-major — column = week (oldest left, current
 *   week right), row = weekday (Sunday = 0). 16 × 7 = 112 cells. The first cell is the
 *   Sunday that opens the week 15 weeks before today's week, so the last column always
 *   contains today: a ride logged this morning shows up the day it is ridden, and the
 *   trailing cells of the current week are future days that stay at 0.
 * - **Bars**: one total per column, labelled `W1` (oldest) … `W16` (current week).
 *
 * TSS is bucketed by calendar day in the rider's local zone (`dailyTss`), the same key
 * the PMC uses — a ride stored as `2026-10-01T06:30` lands on the day the rider rode.
 */

import { dailyTss, isoLocalDay, type PmcInput } from './pmc';

export const HEATMAP_WEEKS = 16;
const DAYS_PER_WEEK = 7;
const CELLS = HEATMAP_WEEKS * DAYS_PER_WEEK;

export interface HeatmapCell {
  /** local calendar day, YYYY-MM-DD */
  date: string;
  tss: number;
}

export interface HeatmapWeek {
  /** `W1` (oldest) … `W16` (current week) */
  label: string;
  tss: number;
}

export interface HeatmapModel {
  /** 112 cells, column-major: index = week * 7 + weekday, oldest week first */
  cells: HeatmapCell[];
  /** 16 weekly totals, oldest first — one per grid column */
  weeks: HeatmapWeek[];
  /** mean TSS of the weeks that carried load, rounded; 0 when none did */
  avgTss: number;
  /** largest week total, floored at 1 so bar heights always divide */
  maxWeek: number;
  /** smallest week total (0 while any week in the window is empty) */
  minWeek: number;
  /** largest single day, floored at 1 so heat levels always divide */
  maxDay: number;
}

/** Heat bucket for one cell, against the grid's max day. 0 = rest day. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export function buildHeatmap(items: readonly PmcInput[], now = new Date()): HeatmapModel {
  const byDay = dailyTss(items);

  // First cell = the Sunday opening the week 15 weeks before today's week, so the last
  // column always contains today (the current week's future days read as 0).
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay() - (HEATMAP_WEEKS - 1) * DAYS_PER_WEEK);

  const cells: HeatmapCell[] = [];
  for (let i = 0; i < CELLS; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const date = isoLocalDay(d);
    cells.push({ date, tss: byDay.get(date) ?? 0 });
  }

  // One bar per grid column — summing the column keeps bars and grid on one calendar.
  const weeks: HeatmapWeek[] = [];
  for (let w = 0; w < HEATMAP_WEEKS; w++) {
    let tss = 0;
    for (let day = 0; day < DAYS_PER_WEEK; day++) tss += cells[w * DAYS_PER_WEEK + day].tss;
    weeks.push({ label: `W${w + 1}`, tss });
  }

  const active = weeks.filter((x) => x.tss > 0);
  const avgTss = active.length > 0 ? Math.round(active.reduce((s, x) => s + x.tss, 0) / active.length) : 0;

  return {
    cells,
    weeks,
    avgTss,
    maxWeek: Math.max(...weeks.map((x) => x.tss), 1),
    minWeek: Math.min(...weeks.map((x) => x.tss)),
    maxDay: Math.max(...cells.map((c) => c.tss), 1)
  };
}

/** Four-step ramp: 0 rest, then <25% / <50% / <75% / ≥75% of the grid's biggest day. */
export function heatLevel(tss: number, maxDay: number): HeatLevel {
  if (tss <= 0) return 0;
  const f = tss / maxDay;
  if (f < 0.25) return 1;
  if (f < 0.5) return 2;
  if (f < 0.75) return 3;
  return 4;
}
