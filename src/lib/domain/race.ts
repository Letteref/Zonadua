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
import type { CriticalPowerFit } from './power-curve';
import { powerForSpeed, type PhysicsParams, type RideSolution } from './physics';

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
 * M4 slice 2: can this rider actually hold this pace?
 *
 * The pacing model answers "how long does this power take over this profile", which
 * assumes the target is sustainable from a full tank. Two things break that:
 *
 *  - **The gradient is steeper than the plan allows for.** Invert the solver with
 *    `powerForSpeed`: the watts needed to hold the plan speed on the *actual* local grade.
 *  - **W' is already spent.** Above CP power is borrowed from a finite anaerobic store;
 *    once it empties, the same watts stop being available at all.
 *
 * Returns null when there is nothing to judge — no fit, no params. "Unknown" must never
 * read as "fine".
 */
export interface SustainProjection {
  /** the point on the route this judgement is about */
  km: number;
  /** watts needed to hold `planKph` on the local gradient */
  requiredW: number;
  /** the rider's critical power, or null when no fit exists */
  cp: number | null;
  /** watts the rider can hold indefinitely; null when no fit exists */
  sustainableW: number | null;
  /** watts available right now after work at power has drawn down W', null without a fit */
  availableW: number | null;
  /** how long this pace must still be held, seconds — what the W' reserve is spread over */
  horizonSec: number | null;
  /** W' left in the tank (J), null without a fit */
  wPrimeLeft: number | null;
  /** W' as a fraction of its full capacity, 0–1, null without a fit */
  wPrimePct: number | null;
  /** true only when the plan pace fits inside what is left */
  sustainable: boolean;
  /** short reason, honest enough to print next to a status chip */
  reason: string;
}

/**
 * W′ spent by riding the plan up to `km`, in joules.
 *
 * This is the honest accounting and it is deliberately NOT `wPrimeRemaining(fit, seconds)`.
 * That function describes the *model curve* P(t) = W′/t + CP — how much total work the
 * minimal model contains — so feeding it elapsed time treats every second as if the rider
 * were pinned on the asymptote, and empties the tank within minutes on any long ride.
 *
 * W′ is spent by **work above CP** and partly replenished by work below it, so the balance
 * integrates the plan: surplus power above CP drains the tank, deficit below CP refills it,
 * and time spent cruising exactly at CP is free. That is why an eight-hour ultra ends with
 * W′ intact while a repeated-above-CP race does not.
 *
 * Segments are the solved ones, so this measures the plan the rider is actually on.
 * Returned value is clamped to `[0, fit.wPrime]`: a deep descent cannot push W′ negative,
 * and a rider cannot bank more than the tank holds.
 */
export function wPrimeSpentAt(
  segments: ReadonlyArray<RideSolution['segments'][number]>,
  fit: CriticalPowerFit,
  km: number
): number {
  if (fit.cp <= 0) return 0;
  let net = 0; // joules above (positive) / below (negative) CP
  for (const s of segments) {
    // a segment records where it ends, so stop before the one that overruns the distance
    if (s.cumDistKm > km) break;
    net += (s.powerUsedW - fit.cp) * s.sec;
  }
  return Math.max(0, Math.min(fit.wPrime, net));
}

/**
 * Whether the plan speed at `km` is still holdable given the W′ spent getting there.
 *
 * `wPrimeSpentJ` is in joules and comes from {@link wPrimeSpentAt} — pass what the plan has
 * actually cost at this distance, not elapsed wall-clock.
 *
 * `horizonSec` is **how long this pace has to be held**, and it genuinely changes the
 * answer: 5 kJ of reserve buys ~167 W on top of CP for 30 s, but only ~8 W if it must last
 * 600 s. Sizing the reserve without a duration collapses to `wPrimeLeft / t_lim`, which
 * simplifies to exactly CP for *any* tank size — a two-kilowatt-second rider would then
 * borrow as much as a twenty-kilojoule one, which is nonsense.
 */
export function sustainAt(
  rows: readonly PlanSeriesPoint[],
  km: number,
  physics: PhysicsParams,
  fit: CriticalPowerFit | undefined,
  wPrimeSpentJ: number,
  horizonSec: number
): SustainProjection | null {
  const row = rowAt(rows, km);
  if (!row) return null;

  const requiredW = Math.round(powerForSpeed(physics, row.gradePct, row.kph));
  if (!fit || fit.cp <= 0 || fit.wPrime <= 0) {
    return {
      km,
      requiredW,
      cp: null,
      sustainableW: null,
      availableW: null,
      horizonSec: null,
      wPrimeLeft: null,
      wPrimePct: null,
      // Without a fit the gradient is still judged; there is simply no W' to reason about.
      sustainable: true,
      reason: 'No CP fit — pace judged against the plan only'
    };
  }

  const wPrimeLeft = Math.max(0, fit.wPrime - Math.max(0, wPrimeSpentJ));
  // Power still available: sustainable CP, plus the average surplus the remaining reserve
  // can carry across the stretch this pace has to be held.
  const horizon = Math.max(1, horizonSec);
  const borrowedW = wPrimeLeft > 0 ? Math.min(wPrimeLeft / horizon, fit.wPrime / fit.cp) : 0;
  const availableW = Math.round(fit.cp + borrowedW);
  const sustainable = requiredW <= availableW;

  let reason: string;
  if (requiredW <= fit.cp) reason = 'Pace sits below CP — sustainable indefinitely';
  else if (sustainable) reason = 'W′ still covers the gap above CP';
  else if (wPrimeLeft <= 0) reason = 'W′ is spent — the plan’s power is no longer available';
  else reason = 'Gap above CP exceeds what the remaining W′ can buy';

  return {
    km,
    requiredW,
    cp: Math.round(fit.cp),
    sustainableW: Math.round(fit.cp),
    availableW,
    horizonSec: Math.round(horizon),
    wPrimeLeft: Math.round(wPrimeLeft),
    wPrimePct: Math.max(0, Math.min(1, wPrimeLeft / fit.wPrime)),
    sustainable,
    reason
  };
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
/**
 * Post-race: what the plan promised against what the rider actually did (M4 DoD).
 *
 * ## Why this returns null so eagerly
 *
 * A correction factor is only meaningful against a baseline that was written down *before*
 * the start. `planJson` records the rider's settings, not the solver's answer, so a race
 * finished today has no estimate to compare against at all — and the honest reading of
 * that is "not measured", not "on target". Anything else would fabricate a calibration
 * factor out of nothing, which is worse than having none: the factor would then look
 * evidence-based to everything downstream, including M5's context builder.
 */
export interface RaceOutcome {
  /** the estimate the rider agreed to, in minutes */
  planMin: number;
  /** what it took, in minutes */
  actualMin: number;
  /** actual − plan; positive means slower than promised */
  deltaMin: number;
  /** deltaMin as a fraction of planMin */
  deltaPct: number;
}

export interface RaceOutcomeInput {
  /** minutes past midnight of the start gun */
  startMin: number;
  /** the planned finish, in minutes past midnight — null if never recorded */
  plannedFinishMin: number | null | undefined;
  /** elapsed ride time at "Finish & save", in minutes — null if the race was never finished */
  actualFinishMin: number | null | undefined;
}

/**
 * Compare a finished race against its own estimate.
 *
 * Both halves must be present and the plan must be longer than zero. A zero-length plan
 * makes the percentage meaningless (0/0), so it is refused rather than reported as 0 %.
 */
export function raceOutcome(input: RaceOutcomeInput): RaceOutcome | null {
  const { startMin, plannedFinishMin, actualFinishMin } = input;
  if (plannedFinishMin == null || actualFinishMin == null) return null;
  if (!Number.isFinite(plannedFinishMin) || !Number.isFinite(actualFinishMin)) return null;
  const planMin = plannedFinishMin - startMin;
  const actualMin = actualFinishMin;
  if (planMin <= 0) return null;
  const deltaMin = actualMin - planMin;
  return { planMin, actualMin, deltaMin, deltaPct: deltaMin / planMin };
}

/**
 * How to read a set of outcomes.
 *
 * Deliberately a *report*, not a multiplier: nothing here feeds back into `buildPlan`.
 * A single race is too small a sample to correct a solver with, and applying the factor
 * would hide the very evidence M5 needs to calibrate on. `medianDeltaPct` is the robust
 * statistic — one bad day (a crash, a mechanical) should not drag the read on the others.
 */
export interface OutcomeReadout {
  /** races where both an estimate and an actual were recorded */
  compared: number;
  /** median (actual − plan)/plan across those races, null when there are none */
  medianDeltaPct: number | null;
  /** the most recent compared race, null when there are none */
  latest: { name: string; at: number; outcome: RaceOutcome } | null;
}

export function readoutOfOutcomes(
  items: ReadonlyArray<{ name: string; at: number; outcome: RaceOutcome | null }>
): OutcomeReadout {
  const compared = items.filter((i): i is { name: string; at: number; outcome: RaceOutcome } =>
    i.outcome != null
  );
  if (compared.length === 0) return { compared: 0, medianDeltaPct: null, latest: null };

  const pcts = compared.map((i) => i.outcome.deltaPct).sort((a, b) => a - b);
  const mid = Math.floor(pcts.length / 2);
  const medianDeltaPct =
    pcts.length % 2 === 1 ? pcts[mid] : (pcts[mid - 1] + pcts[mid]) / 2;

  const latest = compared.reduce((a, b) => (b.at >= a.at ? b : a));
  return { compared: compared.length, medianDeltaPct, latest };
}
