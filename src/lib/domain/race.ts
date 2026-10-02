/**
 * Race projection helpers — ARCHITECTURE.md §5.4 (F7), slice 1.
 *
 * The live cockpit already owns the "where am I now" projection; this module owns the
 * question the crosshair asks: *at this point on the route, how much slack is left
 * against the next cut-off?* Everything derives from the same `planSeries` rows the
 * chart draws, so the tooltip cannot disagree with the chart or the hero numbers.
 *
 * Deliberately not here yet: full M4 (`powerForSpeed` feasibility vs CP/W′, deviation vs
 * plan, personal calibration). This is the piece the cockpit chart needs first.
 */

import type { PlanSeriesPoint } from './pacing';

export type Feasibility = 'aman' | 'waspada' | 'kritis';

export interface CutoffGate {
  /** distance from the start, km */
  km: number;
  /** cut-off as minutes after the start gun */
  cutoffMin: number;
  label?: string;
}

/**
 * Slack bands, in minutes, matching the cockpit status strip: 20 min of slack is where
 * a plan stops being comfortable, and zero is where it stops being a plan.
 */
export const AMAN_MIN = 20;

export function feasibility(bufferMin: number): Feasibility {
  if (bufferMin < 0) return 'kritis';
  if (bufferMin < AMAN_MIN) return 'waspada';
  return 'aman';
}

export interface GateProjection {
  /** the gate this position is being measured against */
  gateKm: number;
  gateLabel: string;
  cutoffMin: number;
  /** clock time (minutes past midnight) the plan puts you here */
  clockMin: number;
  /** positive = ahead of the cut-off */
  bufferMin: number;
  feasibility: Feasibility;
  /** distance from the hovered point to the gate */
  remainingKm: number;
  /** speed the plan holds at the hovered point, km/h */
  kph: number;
}

/** Row at or immediately before `km`, interpolated so the clock is continuous. */
function rowAt(rows: readonly PlanSeriesPoint[], km: number): PlanSeriesPoint | null {
  if (rows.length === 0) return null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (km <= first.km) return first;
  if (km >= last.km) return last;
  let lo = 0;
  let hi = rows.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].km <= km) lo = mid;
    else hi = mid;
  }
  const a = rows[lo];
  const b = rows[hi];
  const span = b.km - a.km;
  const f = span > 0 ? (km - a.km) / span : 0;
  return {
    km,
    altM: a.altM + (b.altM - a.altM) * f,
    gradePct: a.gradePct + (b.gradePct - a.gradePct) * f,
    kph: a.kph + (b.kph - a.kph) * f,
    elapsedSec: a.elapsedSec + (b.elapsedSec - a.elapsedSec) * f,
    clockMin: a.clockMin + (b.clockMin - a.clockMin) * f,
    powerLimited: f < 0.5 ? a.powerLimited : b.powerLimited
  };
}

/**
 * Buffer against the next gate ahead of `km`.
 *
 * The gate is the *first* cut-off at or beyond the hovered point — sitting 5 km before a
 * cut-off is exactly when the rider wants to know the slack. Past the last gate the finish
 * cut-off is the one that matters, so the last gate always wins as a fallback. Returns
 * null when there is nothing to measure against, because "no gate" must not read as "safe".
 */
export function gateBufferAt(
  rows: readonly PlanSeriesPoint[],
  gates: readonly CutoffGate[],
  km: number
): GateProjection | null {
  if (rows.length < 2 || gates.length === 0) return null;
  const row = rowAt(rows, km);
  if (!row) return null;

  const gate = gates.find((g) => g.km >= km - 1e-9) ?? gates[gates.length - 1];
  const bufferMin = gate.cutoffMin - row.clockMin;
  return {
    gateKm: gate.km,
    gateLabel: gate.label ?? `KM ${Math.round(gate.km)}`,
    cutoffMin: gate.cutoffMin,
    clockMin: row.clockMin,
    bufferMin,
    feasibility: feasibility(bufferMin),
    remainingKm: Math.max(0, gate.km - km),
    kph: row.kph
  };
}

/** The gate the rider has already passed — used to label the "last cut-off" chip. */
export function lastGatePassed(
  gates: readonly CutoffGate[],
  km: number
): CutoffGate | null {
  let best: CutoffGate | null = null;
  for (const g of gates) if (g.km <= km) best = g;
  return best;
}

/**
 * Clock time the plan puts you at `km`, interpolated so the answer is continuous.
 * This is the *forward* lookup `gateBufferAt` does not need, and the live hero cannot do
 * without: the projected finish is "how much plan is left from where I am", which needs
 * the clock at two distances, not a buffer.
 */
export function clockAtKm(rows: readonly PlanSeriesPoint[], km: number): number | null {
  const row = rowAt(rows, km);
  return row ? row.clockMin : null;
}

/**
 * Where the plan says you are at `clockMin` — the inverse of {@link clockAtKm}.
 *
 * This is what the live tracker reads *before* the first checkpoint is logged: rather
 * than assuming a constant average speed, it puts the marker exactly where the solved
 * profile says it should be, so the chart and the hero cannot disagree.
 */
export function kmAtClock(rows: readonly PlanSeriesPoint[], clockMin: number): number | null {
  if (rows.length < 2) return null;
  // rows are ordered by distance, and elapsed time is monotonic with distance, so
  // bracket on clockMin with the same binary search
  let lo = 0;
  let hi = rows.length - 1;
  if (clockMin <= rows[lo].clockMin) return rows[lo].km;
  if (clockMin >= rows[hi].clockMin) return rows[hi].km;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].clockMin <= clockMin) lo = mid;
    else hi = mid;
  }
  const a = rows[lo];
  const b = rows[hi];
  const span = b.clockMin - a.clockMin;
  const f = span > 0 ? (clockMin - a.clockMin) / span : 0;
  return a.km + (b.km - a.km) * f;
}

/**
 * Minutes of plan remaining between two points on the route, stops included.
 *
 * Clamped at zero on both ends: asking for time "remaining" to a point you have already
 * passed, or from beyond the finish, must not hand back a negative duration.
 */
export function planMinutesBetween(
  rows: readonly PlanSeriesPoint[],
  fromKm: number,
  toKm: number
): number | null {
  const a = clockAtKm(rows, fromKm);
  const b = clockAtKm(rows, toKm);
  if (a == null || b == null) return null;
  return Math.max(0, b - a);
}