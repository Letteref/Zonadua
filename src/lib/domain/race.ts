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
  horizonSec: number,
  /**
   * The segment's own solved gradient and speed, when the caller already knows which
   * segment the judgement is about. `rowAt` **interpolates** between chart rows, so
   * asking about the middle of a segment blends its gradient with its neighbour's and
   * the watts come out describing terrain the solver never rode — a 4.2 % ramp judged
   * on a 3.5 % average. An obstacle knows its steepest segment exactly, so it passes
   * that pair through; a caller judging at a chart row (the route verdict, the race
   * page) has the row's own values already and passes nothing.
   */
  at?: { gradePct: number; kph: number }
): SustainProjection | null {
  const row = rowAt(rows, km);
  if (!row) return null;

  const requiredW = Math.round(powerForSpeed(physics, at?.gradePct ?? row.gradePct, at?.kph ?? row.kph));
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
 * Route-wide verdict: can this rider hold this plan from the gun to the finish?
 *
 * `unknown` when there is no CP fit — and that value is the point of naming it: with no
 * fit `sustainAt` still judges the gradient and reports `sustainable: true`, which is a
 * perfectly true statement about a rider nobody measured. A caller that printed that as
 * "you can ride this" would turn missing data into a green light, so the no-fit path is a
 * first-class verdict here rather than a `true` the component has to remember to distrust.
 */
export type RouteVerdict = 'unknown' | 'sustainable' | 'limited' | 'spent';

export interface RouteCapability {
  verdict: RouteVerdict;
  /**
   * The first point the plan stops being fundable, km from the start — null when every
   * sampled point holds. Rows are distance-ordered (`planSeries` preserves solve order),
   * so "first" is where the rider first meets the problem, not the worst point on the
   * route: a plan that fails early and recovers on a descent still fails, and the earliest
   * km is where the rider must change something.
   */
  breakKm: number | null;
  /**
   * The judgement the verdict rests on: at the break when there is one, otherwise at the
   * tightest point — the largest `requiredW − availableW` deficit — so a passing plan
   * still hands back evidence (its narrowest margin) instead of a bare boolean.
   */
  at: SustainProjection;
}

/**
 * Scan the whole plan and answer the estimator's question: *can this rider ride it?*
 *
 * This composes the two primitives the cockpit already trusts, over every row of
 * `planSeries` instead of the one a crosshair happens to hover:
 *
 *  - **W′ accounting** — `wPrimeSpentAt` charges work above CP along the solver's own
 *    segments (and credits recovery below it), so a descent genuinely refills the tank.
 *  - **Horizon** — the remaining plan time to the finish, exactly the construction the
 *    cockpit's live tracker uses (`nowSustain`): "hold this pace from here to the end".
 *
 * ## Why walls do not dominate the verdict
 *
 * A power-limited ramp is judged at the plan's *stalled* speed (`vMin`, ~5 km/h), which
 * costs little power — the crawl up a 15 % wall is cheaper than a fast flat. So a wall
 * breaks the verdict only when it genuinely exceeds what CP + reserve can fund, which is
 * also when the route's own `powerLimitedPct` banner is already complaining. The two
 * warnings stay independent and neither can cry wolf on terrain the rider can walk up.
 *
 * ## Why the earliest break, not the largest deficit
 *
 * A route-level verdict is an instruction ("this plan stops working at km X"), and the
 * instruction is only actionable at the point the rider first reaches it. The tightest
 * point is still returned — it is `at` when the plan passes — so the panel can show the
 * narrowest margin even when there is nothing to break.
 *
 * Returns null only when there is no plan to scan (`rows.length < 2`) — "no plan" and
 * "no CP fit" are different absences and keep different faces.
 */
export function routeCapability(
  rows: readonly PlanSeriesPoint[],
  segments: ReadonlyArray<RideSolution['segments'][number]>,
  physics: PhysicsParams,
  fit: CriticalPowerFit | undefined
): RouteCapability | null {
  if (rows.length < 2) return null;
  const canJudge = fit !== undefined && fit.cp > 0 && fit.wPrime > 0;
  const finishKm = rows[rows.length - 1].km;

  let tightest: SustainProjection | null = null;
  let tightestKey = -Infinity;
  let firstBreak: SustainProjection | null = null;

  for (const row of rows) {
    const spent = canJudge ? wPrimeSpentAt(segments, fit!, row.km) : 0;
    const holdMin = planMinutesBetween(rows, row.km, finishKm) ?? 0;
    const s = sustainAt(rows, row.km, physics, canJudge ? fit : undefined, spent, holdMin * 60);
    if (!s) continue;
    // With a fit the tightest point is the largest deficit; without one `availableW` is
    // null and the steepest demand is all there is to rank by.
    const key = s.availableW != null ? s.requiredW - s.availableW : s.requiredW;
    if (key > tightestKey) {
      tightestKey = key;
      tightest = s;
    }
    if (!firstBreak && !s.sustainable) firstBreak = s;
  }
  if (!tightest) return null;

  if (!canJudge) return { verdict: 'unknown', breakKm: null, at: tightest };
  if (!firstBreak) return { verdict: 'sustainable', breakKm: null, at: tightest };
  return {
    verdict: firstBreak.wPrimeLeft === 0 ? 'spent' : 'limited',
    breakKm: firstBreak.km,
    at: firstBreak
  };
}

/**
 * One terrain feature the plan must survive: a **climb** (sustained grade) or a **wall**
 * (the solver ran out of target power and stalled at the 5 km/h floor).
 */
export interface RouteObstacle {
  kind: 'climb' | 'wall';
  startKm: number;
  endKm: number;
  lengthKm: number;
  /** rise ÷ run over the whole feature, percent */
  avgGradePct: number;
  /** steepest solved segment in the feature, percent */
  maxGradePct: number;
  /** `sustainAt` at the centre of the steepest stretch — the feature's tightest moment */
  judgement: SustainProjection;
}

export interface ObstacleOptions {
  /** grade that starts a climb — 3 % is the cycling convention for a classified ramp */
  minGradePct?: number;
  /** shorter is GPX jitter, not terrain — except walls, which bite at any length */
  minKm?: number;
}

/**
 * Enumerate the route's obstacles, worst first — the list the capability card expands
 * under "Route obstacles".
 *
 * ## What counts
 *
 * A maximal *consecutive* run of solved segments that are either steeper than
 * `minGradePct` or `powerLimited`. No merging across a single flat metre: a climb, a
 * breath, then a ramp are two separate problems for a rider, and folding them together
 * would grade the middle as if it were hill. The name follows geometry (`climb` when
 * the steepest segment clears the threshold, else `wall`) — danger is the status
 * word's job, not the label's.
 *
 * ## How each feature is judged
 *
 * At the **centre of its steepest stretch**, through the same three primitives the route
 * verdict uses (`wPrimeSpentAt` → `planMinutesBetween` → `sustainAt`), so a row in this
 * list and the card's headline can never disagree about the engine behind them. Equal
 * gradients are read as one plateau rather than broken by "whichever comes first": a
 * uniform ramp's segments agree to floating-point noise (~1e-15), so a strict `>` always
 * crowned the feature's **opening metre** — and a climb starting at km 0 then reported
 * "tightest at km 0.0", the range's own boundary, which reads to the rider as a pointer
 * at the segment start rather than at the steepest point. The judgement also carries
 * that segment's own solved gradient and speed, for the interpolation reason `at` gives.
 * Without a CP fit the geometry is still real and still listed — `judgement.cp` is null,
 * and the card shows no status word rather than inventing one.
 *
 * ## Why worst-first
 *
 * The list answers "what will bite me today?" — an empty tank (`spent`) leads, a gap
 * the reserve can't buy (`limited`) follows, passes trail. Distance order is what a
 * map wants; this is what a rider wants, and every row still carries its km range.
 */
export function routeObstacles(
  rows: readonly PlanSeriesPoint[],
  segments: ReadonlyArray<RideSolution['segments'][number]>,
  physics: PhysicsParams,
  fit: CriticalPowerFit | undefined,
  opts: ObstacleOptions = {}
): RouteObstacle[] {
  const minGradePct = opts.minGradePct ?? 3;
  const minKm = opts.minKm ?? 0.5;
  if (rows.length < 2 || segments.length === 0) return [];
  const finishKm = rows[rows.length - 1].km;
  const canJudge = !!fit && fit.cp > 0 && fit.wPrime > 0;

  type Seg = RideSolution['segments'][number];
  /**
   * A segment plus where IT begins. The solver records where a segment *ends* —
   * `distKm` is the end distance, identical to `cumDistKm` — so a feature's start is
   * its first segment's predecessor's end, the same rule pacing's `segStartKm` uses.
   * (`cumDistKm − distKm` is identically zero on real data; computing starts that way
   * collapses every feature onto km 0.)
   */
  interface Tracked {
    seg: Seg;
    startKm: number;
  }
  const runs: Tracked[][] = [];
  let current: Tracked[] = [];
  let prevEnd = 0;
  for (const s of segments) {
    if (s.gradePct >= minGradePct || s.powerLimited) current.push({ seg: s, startKm: prevEnd });
    else if (current.length) {
      runs.push(current);
      current = [];
    }
    prevEnd = s.cumDistKm;
  }
  if (current.length) runs.push(current);

  const out: RouteObstacle[] = [];
  for (const run of runs) {
    const startKm = run[0].startKm;
    const endKm = run[run.length - 1].seg.cumDistKm;
    const lengthKm = endKm - startKm;
    const isWall = run.some((t) => t.seg.powerLimited);
    if (lengthKm < minKm && !isWall) continue; // jitter, not terrain

    const riseM = run.reduce((sum, t) => sum + t.seg.riseM, 0);
    const maxGradePct = run.reduce((m, t) => (t.seg.gradePct > m ? t.seg.gradePct : m), -Infinity);
    // Gradients equal to within floating-point noise are ONE stretch of terrain — a
    // uniform ramp disagrees with itself only in the 15th decimal, and letting `>`
    // resolve that is a decision about noise, not about terrain. The point reported is
    // the plateau's centre, where "the steepest part" actually means something.
    const sameGrade = (g: number): boolean => Math.abs(g - maxGradePct) <= 1e-9;
    const firstMax = run.findIndex((t) => sameGrade(t.seg.gradePct));
    let lastMax = firstMax;
    while (lastMax + 1 < run.length && sameGrade(run[lastMax + 1].seg.gradePct)) lastMax++;
    const tightest = run[firstMax + Math.floor((lastMax - firstMax) / 2)];
    const km = tightest.startKm + (tightest.seg.cumDistKm - tightest.startKm) / 2;
    const holdMin = planMinutesBetween(rows, km, finishKm) ?? 0;
    const spent = canJudge ? wPrimeSpentAt(segments, fit!, km) : 0;
    const judgement = sustainAt(rows, km, physics, canJudge ? fit : undefined, spent, holdMin * 60, {
      gradePct: tightest.seg.gradePct,
      kph: tightest.seg.vKph
    });
    if (!judgement) continue;

    out.push({
      kind: maxGradePct >= minGradePct ? 'climb' : 'wall',
      startKm,
      endKm,
      lengthKm,
      avgGradePct: (riseM / (lengthKm * 1000)) * 100,
      maxGradePct,
      judgement
    });
  }

  const rank = (o: RouteObstacle): number => {
    if (!canJudge || o.judgement.sustainable) return 0;
    return o.judgement.wPrimeLeft === 0 ? 2 : 1;
  };
  // required − available; without a fit that margin is null and the steepest demand
  // decides — same tie-break rule as routeCapability's tightest point
  const deficit = (o: RouteObstacle): number =>
    o.judgement.availableW != null ? o.judgement.requiredW - o.judgement.availableW : o.judgement.requiredW;
  return out.sort((a, b) => rank(b) - rank(a) || deficit(b) - deficit(a) || a.startKm - b.startKm);
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

/** The shape a cut-off travels in — structurally `RaceCheckpoint` without the Dexie import. */
export interface StoredCutoff {
  km: number;
  label?: string;
  /** minutes AFTER the start the race was saved with */
  cutoffMin?: number;
}

/**
 * Re-express a race's cut-offs against the start being saved.
 *
 * ## Why this translation exists
 *
 * The two screens speak different units **on purpose**, and `Save as race plan` is the
 * only bridge between them. The estimator's checkpoint table speaks wall-clock gates —
 * it buffers the solved arrival against "finish by 13:00", whatever hour you roll out.
 * The race page stores minutes *after the start* (`start + cutoff`) because its editor
 * takes the time-of-day a rider types and converts it with `wall − start`, and its
 * hard-limit dial edits a duration. When the saved start changes — the departure picker
 * can move it hours at a time — copying the stored numbers across unchanged would drag
 * the gate along with them: a 13 h limit set for a 05:30 roll-out read against 21:00
 * becomes a gate at 10:30 the next morning, and the "beat 13:00" the estimator showed
 * never appears anywhere.
 *
 * So each stored cut-off is **rebased**: the wall-clock gate it produced under the
 * previous start (`prevStart + stored`) is kept, and re-expressed as a duration from
 * the start now being saved — exactly the arithmetic the race page's own checkpoint
 * editor performs. A gate that now sits before the roll-out (a later start over a
 * morning gate) has no non-negative duration to express; the finish falls back to the
 * race page's own dial floor (120 min) and checkpoints to 0, so the rider sees a
 * shortened-but-honest window rather than a negative limit nobody typed.
 */
export function rebaseCutoffsForStart(input: {
  /** the stored race's cut-offs, measured from ITS start; `null` on a fresh save */
  prev: { startWallMin: number; cutoffFinishMin: number; checkpoints: readonly StoredCutoff[] } | null;
  /** wall-clock gates for a fresh save — the estimator's own table, minutes past midnight */
  freshGates: {
    finishWallMin?: number;
    /**
     * The finish limit as a duration from the start, when the caller already knows it
     * (the estimator just solved the ride). Wins over the wall-clock gate: a gate past
     * midnight cannot survive wall arithmetic — it wraps to a morning clock and collapses
     * to the floor — while an overnight race's true limit (10 h from a 22:00 gun) is
     * exactly that case.
     */
    finishDurationMin?: number;
    checkpoints: readonly { km: number; label?: string; gateWallMin: number }[];
  };
  /** minutes past midnight of the start being saved */
  nextStartWallMin: number;
  /** the race page's finish-dial floor, minutes (its own buttons stop at 120) */
  minFinishMin?: number;
}): { cutoffFinishMin: number; checkpoints: StoredCutoff[] } {
  const wall = (min: number): number => ((min % 1440) + 1440) % 1440;
  const floor = input.minFinishMin ?? 120;
  /** keep the gate, measure it from the new start, never below the caller's floor */
  const rebase = (gateWall: number, min: number): number =>
    Math.max(min, wall(gateWall) - wall(input.nextStartWallMin));

  if (input.prev) {
    const p = input.prev;
    return {
      cutoffFinishMin: rebase(p.startWallMin + p.cutoffFinishMin, floor),
      checkpoints: p.checkpoints.map((c) =>
        c.cutoffMin == null ? { ...c } : { ...c, cutoffMin: rebase(p.startWallMin + c.cutoffMin, 0) }
      )
    };
  }
  const g = input.freshGates;
  return {
    cutoffFinishMin:
      g.finishDurationMin != null
        ? Math.max(floor, g.finishDurationMin)
        : g.finishWallMin != null
          ? rebase(g.finishWallMin, floor)
          : floor,
    checkpoints: g.checkpoints.map((c) => ({
      km: c.km,
      ...(c.label !== undefined ? { label: c.label } : {}),
      cutoffMin: rebase(c.gateWallMin, 0)
    }))
  };
}

/**
 * Combine the planner's checkpoint list with a race's stored gates.
 *
 * `Save as race plan` writes the *positions the rider is looking at* — including edits
 * made in the planner's table — so a save over an existing race cannot simply keep the
 * race's old kilometres: that would silently discard the edits it was pressed to apply.
 * But the gates the rider entered on the race page are facts too, so each one is
 * re-attached to the planner point sitting on its kilometre (0.1 grid). A point the rider
 * deleted or moved takes its gate with it, on purpose — the gate belonged to that spot.
 *
 * `stored` is expected to carry already-rebased cut-offs (see `rebaseCutoffsForStart`);
 * this function only matches, it does no start-time arithmetic.
 */
export function checkpointsWithStoredGates(
  planner: readonly { km: number; label?: string }[],
  stored: readonly StoredCutoff[]
): StoredCutoff[] {
  const gateByKm = new Map<number, number>();
  for (const c of stored) {
    if (c.cutoffMin != null) gateByKm.set(Math.round(c.km * 10) / 10, c.cutoffMin);
  }
  return planner.map((c) => {
    const gate = gateByKm.get(Math.round(c.km * 10) / 10);
    return {
      km: c.km,
      ...(c.label != null && c.label !== '' ? { label: c.label } : {}),
      ...(gate != null ? { cutoffMin: gate } : {})
    };
  });
}
