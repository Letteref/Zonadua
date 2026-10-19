/**
 * Ride planning — ARCHITECTURE.md §5.3 (F6): pacing strategy, stop policy and the
 * checkpoint table.
 *
 * This is the layer that turns "a speed per metre" into "what time will I arrive here",
 * which is the only thing a checkpoint table is actually for. Everything derives from the
 * physics solution, so the table can never disagree with the total estimate.
 */

import {
  kilojoulesForRide,
  solveRide,
  type PhysicsParams,
  type ProfilePoint,
  type RideSolution
} from './physics';

export type PacingMode = 'if' | 'np' | 'constant';

export interface PacingStrategy {
  mode: PacingMode;
  /** target intensity factor, used when mode = 'if' */
  ifTarget?: number;
  /** rider FTP, used when mode = 'if' */
  ftp?: number;
  /** target normalized power in watts, used when mode = 'np' or 'constant' */
  watts?: number;
}

/**
 * Resolve a strategy to a power target.
 * Returns 0 when the inputs cannot produce a target — the caller must show "unknown"
 * rather than divide by an unknown FTP.
 */
export function resolveTargetWatts(s: PacingStrategy): number {
  if (s.mode === 'constant') return Math.max(0, s.watts ?? 0);
  if (s.mode === 'np') return Math.max(0, s.watts ?? 0);
  const ftp = s.ftp ?? 0;
  if (ftp <= 0) return 0;
  return Math.max(0, (s.ifTarget ?? 0) * ftp);
}

export interface SpeedFit {
  /** intensity whose plan lands closest to the target average speed */
  ifTarget: number;
  /** the plan actually solved at `ifTarget` — feeds "≈ x.x km/h" in the UI */
  avgKph: number;
  /** true when the target sits inside what this rider + setup can produce */
  reachable: boolean;
  /** honest sentence when it does not; null when the target is met */
  note: string | null;
}

/**
 * Solve for the intensity factor that makes a plan average `targetKph`.
 *
 * An average-speed target is a *derived* target: it has no direct knob in the solver,
 * which speaks watts. But average speed rises monotonically with intensity, so a
 * bisection finds the IF whose plan lands on the number the rider named — without a
 * search library and without the UI inventing an answer.
 *
 * The builder is passed in rather than built here so the caller keeps ownership of
 * physics, stops, wind and start time: the fit must walk *the same inputs* the screen
 * will finally solve with, or the fitted IF describes a ride nobody is planning.
 *
 * Unreachable targets are reported, never clamped silently — "200 km/h" must say so,
 * because a speed the setup cannot produce is a wrong answer dressed as a plan.
 */
export function fitIfForAvgSpeed(
  build: (ifTarget: number) => RidePlan,
  targetKph: number
): SpeedFit {
  const at = (ift: number): number => {
    const p = build(ift);
    return p.ok ? (p.avgKph ?? 0) : 0;
  };

  const lo = 0.3;
  const hi = 1.4;
  const slowest = at(lo);
  const fastest = at(hi);

  if (fastest <= 0) {
    return {
      ifTarget: 0.7,
      avgKph: 0,
      reachable: false,
      note: 'No power model to pace by — set an FTP, then the speed target can be solved.'
    };
  }
  if (fastest < targetKph) {
    return {
      ifTarget: hi,
      avgKph: fastest,
      reachable: false,
      note: `This setup tops out near ${fastest.toFixed(1)} km/h — the target is beyond what it can produce.`
    };
  }
  if (slowest > targetKph) {
    return {
      ifTarget: lo,
      avgKph: slowest,
      reachable: false,
      note: `Even the easiest pace here averages ${slowest.toFixed(1)} km/h — the target is slower than that.`
    };
  }

  let a = lo;
  let b = hi;
  for (let i = 0; i < 22; i++) {
    const mid = (a + b) / 2;
    if (at(mid) < targetKph) a = mid;
    else b = mid;
  }
  const ifTarget = Math.round(((a + b) / 2) * 100) / 100;
  const avgKph = at(ifTarget);
  const gap = Math.abs(avgKph - targetKph);
  return {
    ifTarget,
    avgKph,
    reachable: gap < 0.5,
    note: gap < 0.5 ? null : `Solves to ${avgKph.toFixed(1)} km/h — the nearest this profile gets.`
  };
}

export interface StopPolicy {
  /** number of refuelling/food stops */
  count: number;
  /** minutes lost per stop */
  minutesEach: number;
}

export const totalStopSec = (s: StopPolicy): number => Math.max(0, s.count) * Math.max(0, s.minutesEach) * 60;

export interface CheckpointDef {
  /** distance from the start, km */
  km: number;
  label?: string;
  /** cut-off: minutes after the start */
  cutoffMin?: number;
}

export interface Checkpoint {
  km: number;
  label: string;
  /** elevation reached, m */
  altM: number;
  /** gradient just before the checkpoint, % */
  gradePct: number;
  /** elapsed seconds from the gun, stops included */
  elapsedSec: number;
  /** clock time of day, minutes past midnight */
  clockMin: number;
  /** pace over the leg since the previous checkpoint, km/h */
  legKph: number;
  /** minutes of slack against the cut-off; negative means behind */
  bufferMin?: number;
}

export interface RidePlan {
  /** null when no power target could be resolved — never a fabricated number */
  ok: boolean;
  reason?: string;
  strategy: PacingStrategy;
  targetWatts: number;
  /** clock time of the start gun, minutes past midnight */
  startMin: number;
  solution?: RideSolution;
  /** riding seconds, excluding stops */
  movingSec?: number;
  /** riding seconds + stop seconds */
  elapsedSec?: number;
  stopSec: number;
  avgKph?: number;
  climbM?: number;
  descentM?: number;
  energyKJ?: number;
  powerLimitedCount?: number;
  /** share of the route the rider cannot hold the target power over, 0–100 */
  powerLimitedPct?: number;
  /** watts needed just to hold 15 km/h on the steepest ramp */
  peakRequiredW?: number;
  steepestGradePct?: number;
  checkpoints: Checkpoint[];
  /** clock time of day at the finish, minutes past midnight */
  finishClockMin?: number;
  /** slowest segment and its grade, for the "where it hurts" callout */
  hardest?: { km: number; gradePct: number; vKph: number };
}

export interface PlanParams {
  profile: readonly ProfilePoint[];
  physics: PhysicsParams;
  pacing: PacingStrategy;
  stops: StopPolicy;
  /** clock time of the start gun, minutes past midnight */
  startMin: number;
  checkpoints?: readonly CheckpointDef[];
  /** resample step in metres */
  stepM?: number;
  /** descent speed cap, km/h — races cap lower than free riding */
  vMaxKph?: number;
}

/**
 * Build the whole plan in one pass. `startMin` and the checkpoint list are both required
 * inputs — an ETA without a start time is not a number, it is a duration.
 */
export function buildPlan(params: PlanParams): RidePlan {
  const { profile, physics, pacing, stops, startMin } = params;
  const stopSec = totalStopSec(stops);
  const targetWatts = resolveTargetWatts(pacing);

  if (profile.length < 2) {
    return { ok: false, reason: 'Route profile is empty', strategy: pacing, targetWatts, startMin, stopSec, checkpoints: [] };
  }
  if (targetWatts <= 0) {
    return {
      ok: false,
      reason: pacing.mode === 'if' ? 'Set an FTP to pace by intensity' : 'Set a power target',
      strategy: pacing,
      targetWatts,
      startMin,
      stopSec,
      checkpoints: []
    };
  }

  const withCap = params.vMaxKph ? { ...physics, vMaxKph: params.vMaxKph } : physics;
  const solution = solveRide(profile, withCap, targetWatts, params.stepM ?? 100);

  const totalKm = solution.totalDistKm;
  const defs = params.checkpoints ?? [];
  // Stops are accrued with distance travelled, so the last checkpoint absorbs all of them
  // and its clock time matches the finish estimate exactly. (Riders really do cluster
  // stops on the climbs; a linear split is the honest simple choice.)
  const stopShareAt = (cumKm: number): number =>
    stopSec * Math.min(1, Math.max(0, cumKm / Math.max(0.1, totalKm)));

  let prevKm = 0;
  let prevElapsed = 0;
  const checkpoints: Checkpoint[] = defs.map((cp) => {
    const atKm = Math.min(cp.km, totalKm);
    const seg = nearestSegment(solution, atKm);
    const ridingSec = seg ? seg.cumTimeSec : solution.totalTimeSec;

    const legKm = atKm - prevKm;
    const legSec = ridingSec - prevElapsed;
    const share = stopShareAt(atKm);
    const elapsedSec = ridingSec + share;
    const clockMin = startMin + elapsedSec / 60;

    const c: Checkpoint = {
      km: atKm,
      label: cp.label ?? `KM ${Math.round(atKm)}`,
      altM: seg ? seg.altM : 0,
      gradePct: seg ? seg.gradePct : 0,
      elapsedSec,
      clockMin,
      legKph: legSec > 0 ? legKm / (legSec / 3600) : 0
    };
    if (cp.cutoffMin != null) c.bufferMin = cp.cutoffMin - clockMin;

    prevKm = atKm;
    prevElapsed = ridingSec;
    return c;
  });

  return {
    ok: true,
    strategy: pacing,
    targetWatts,
    startMin,
    solution,
    movingSec: solution.totalTimeSec,
    elapsedSec: solution.totalTimeSec + stopSec,
    stopSec,
    avgKph: solution.avgKph,
    climbM: solution.climbM,
    descentM: solution.descentM,
    energyKJ: Math.round(kilojoulesForRide(solution)),
    powerLimitedCount: solution.powerLimitedCount,
    powerLimitedPct: solution.powerLimitedPct,
    peakRequiredW: solution.peakRequiredW,
    steepestGradePct: solution.segments.reduce((a, s) => (s.gradePct > a ? s.gradePct : a), 0),
    checkpoints,
    finishClockMin: startMin + (solution.totalTimeSec + stopSec) / 60,
    hardest: hardestSegment(solution)
  };
}

function nearestSegment(solution: RideSolution, km: number) {
  let best = solution.segments[0];
  for (const s of solution.segments) {
    if (s.cumDistKm >= km) return s;
    best = s;
  }
  return best;
}

/** The segment with the lowest solved speed — where the ride is actually won or lost. */
function hardestSegment(solution: RideSolution) {
  let worst: RideSolution['segments'][number] | undefined;
  for (const s of solution.segments) {
    if (!worst || s.vKph < worst.vKph) worst = s;
  }
  return worst ? { km: worst.cumDistKm, gradePct: worst.gradePct, vKph: worst.vKph } : undefined;
}

/**
 * Control points for the route actually loaded — derived from its profile, never typed.
 *
 * The planner used to show five literal checkpoints (km 25 / 87 / 120 / 160 / 200.4,
 * named after one imagined course) for every file the rider loaded: the ETAs were solved
 * from physics, but the *positions* belonged to a single mock race. On a 60 km route the
 * finish clamp stacked three of them on the same metre, and `Save as race plan` stamped
 * "CP2 Payakumbuh" onto races that pass no such place.
 *
 * Now the profile decides: one point per ~50 km of the route that actually exists
 * (2–6 of them), plus the finish at its true end. A label describes the terrain that
 * *leads* to the point — a leg that climbs says Climb, a flat one says Flats — because
 * inventing a place name for a hill the app merely sampled would be the same fiction in
 * a friendlier font.
 *
 * No cut-off is attached: gates are facts about an event the estimator does not know.
 * The race page is where a rider enters them (its editor already takes km / label /
 * roll-by); absence is not zero.
 */
export function defaultCheckpoints(profile: readonly ProfilePoint[]): CheckpointDef[] {
  if (profile.length < 2) return [];
  const startKm = profile[0].distKm;
  const totalKm = profile[profile.length - 1].distKm - startKm;
  if (!(totalKm > 0)) return [];
  const round1 = (km: number): number => Math.round(km * 10) / 10;

  // Sub-kilometre "routes" (a lap of the car park, a mis-exported file) get only the
  // finish: two control points forty metres apart are noise, not checkpoints.
  if (totalKm < 1) return [{ km: round1(startKm + totalKm), label: 'Finish Line' }];

  /** elevation anywhere on the polyline, interpolated linearly between samples */
  const altAt = (km: number): number => {
    if (km <= profile[0].distKm) return profile[0].altM;
    for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1];
      const b = profile[i];
      if (b.distKm >= km) {
        const span = b.distKm - a.distKm;
        return span <= 0 ? b.altM : a.altM + ((km - a.distKm) / span) * (b.altM - a.altM);
      }
    }
    return profile[profile.length - 1].altM;
  };

  /** steepest point-to-point grade (%) over the open-closed interval (fromKm, toKm] */
  const maxGradeBetween = (fromKm: number, toKm: number): number => {
    let max = 0;
    for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1];
      const b = profile[i];
      if (b.distKm <= fromKm) continue;
      if (a.distKm >= toKm) break;
      const dKm = b.distKm - a.distKm;
      if (dKm <= 0) continue;
      max = Math.max(max, ((b.altM - a.altM) / (dKm * 1000)) * 100);
    }
    return max;
  };

  const legs = Math.min(6, Math.max(2, Math.round(totalKm / 50)));

  const out: CheckpointDef[] = [];
  let prevKm = startKm;
  for (let i = 1; i <= legs; i++) {
    const km = startKm + (totalKm * i) / (legs + 1);
    const netM = altAt(km) - altAt(prevKm);
    const maxGrade = maxGradeBetween(prevKm, km);
    // A long drag counts as climbing even below any single steep pitch, and a leg that
    // both rises and drops is named by what dominates it — the metres gained.
    const label =
      netM >= 80 || maxGrade >= 4 ? 'Climb'
      : netM <= -40 ? 'Descent'
      : maxGrade < 2 && Math.abs(netM) < 30 ? 'Flats'
      : 'Rolling';
    out.push({ km: round1(km), label });
    prevKm = km;
  }
  out.push({ km: round1(startKm + totalKm), label: 'Finish Line' });
  return out;
}

/**
 * One chart row per point on the route: distance on the x axis, altitude and the *solved*
 * speed on the two y axes, elapsed time for the crosshair.
 *
 * Stops are accrued with distance exactly like the checkpoint table, so the tooltip's
 * elapsed can never disagree with the finish estimate. Long routes are decimated for
 * rendering — but walls (`powerLimited`) are always kept, because those are the honest
 * part of the answer and thinning them out would hide the problem the UI is warning about.
 */
export interface PlanSeriesPoint {
  km: number;
  altM: number;
  gradePct: number;
  kph: number;
  elapsedSec: number;
  clockMin: number;
  powerLimited: boolean;
}

export function planSeries(plan: RidePlan, maxPoints = 500): PlanSeriesPoint[] {
  const sol = plan.solution;
  if (!plan.ok || !sol || sol.segments.length === 0) return [];

  const stopSec = plan.stopSec;
  const totalKm = sol.totalDistKm || 1;
  const stopAt = (km: number): number => stopSec * Math.min(1, Math.max(0, km / totalKm));
  const row = (km: number, altM: number, gradePct: number, kph: number, cumSec: number, powerLimited: boolean): PlanSeriesPoint => {
    const elapsedSec = cumSec + stopAt(km);
    return { km, altM, gradePct, kph, elapsedSec, clockMin: plan.startMin + elapsedSec / 60, powerLimited };
  };

  const segs = sol.segments;
  // The first segment only records its *end* altitude, so the start is reconstructed —
  // otherwise the chart begins a full step late and the finish looks short.
  const first = segs[0];
  const rows = [
    row(0, first.altM - first.riseM, first.gradePct, first.vKph, 0, false),
    ...segs.map((s) => row(s.cumDistKm, s.altM, s.gradePct, s.vKph, s.cumTimeSec, s.powerLimited))
  ];
  if (rows.length <= maxPoints) return rows;

  // Stride chosen so the strided sample *including* both ends fits the budget exactly;
  // `ceil(n / max)` overshoots by one whenever the last index is not a multiple of it.
  const stride = Math.max(1, Math.ceil((rows.length - 1) / Math.max(1, maxPoints - 1)));
  const keep = (extraWalls: boolean): number[] => {
    const idx = new Set<number>();
    for (let i = 0; i < rows.length; i += stride) idx.add(i);
    idx.add(rows.length - 1);
    if (extraWalls) for (let i = 0; i < rows.length; i++) if (rows[i].powerLimited) idx.add(i);
    return [...idx].sort((a, b) => a - b);
  };

  // Walls are worth the extra points unless they would blow the budget on their own —
  // then the uniform stride wins, and the KRITIS banner still reports the share lost.
  const withWalls = keep(true);
  const idx = withWalls.length <= maxPoints ? withWalls : keep(false);
  return idx.map((i) => rows[i]);
}

export interface SlowWindow {
  /** window centre, km from the start */
  km: number;
  /** where the window begins / ends, km */
  fromKm: number;
  toKm: number;
  /** distance-weighted gradient across the window, % */
  gradePct: number;
  /** solved average speed across the window, km/h */
  kph: number;
  /** minutes the plan spends in this window */
  mins: number;
  /** average power actually required across the window, W */
  watts: number;
}

/**
 * The `count` slowest stretches of the route, as fixed-distance windows.
 *
 * The old UI hard-coded three sector names with grades and times that were never solved —
 * a "where it hurts" callout has to come from the same solver as the finish estimate, or it
 * will happily contradict it. Windows are non-overlapping and taken slowest-first, so the
 * rider sees the genuinely worst places to spend energy rather than three invented hills.
 */
export function slowestWindows(solution: RideSolution, count = 3, windowKm = 10): SlowWindow[] {
  const segs = solution.segments;
  if (segs.length < 2) return [];

  const windows: SlowWindow[] = [];
  // `Segment.distKm` is the distance at the segment's END, not its own length, so a
  // window's length has to come from the difference of cumulative distances. Summing
  // `distKm` instead compounds the total distance and invents a 250 km/h descent.
  const segLenKm = (idx: number): number =>
    idx === 0 ? segs[0].cumDistKm : Math.max(0, segs[idx].cumDistKm - segs[idx - 1].cumDistKm);
  const segStartKm = (idx: number): number => (idx === 0 ? 0 : segs[idx - 1].cumDistKm);

  let i = 0;
  while (i < segs.length) {
    const fromKm = segStartKm(i);
    let j = i;
    let dist = 0;
    let sec = 0;
    let rise = 0;
    let wattSec = 0;
    while (j < segs.length) {
      const s = segs[j];
      dist += segLenKm(j);
      sec += s.sec;
      rise += s.riseM;
      wattSec += s.powerUsedW * s.sec;
      j++;
      // close the window once it is wide enough, or when the route ends
      if (dist >= windowKm) break;
    }
    const toKm = segs[j - 1].cumDistKm;
    if (dist <= 0 || sec <= 0) break;
    windows.push({
      km: (fromKm + toKm) / 2,
      fromKm,
      toKm,
      gradePct: (rise / (dist * 1000)) * 100,
      kph: dist / (sec / 3600),
      mins: sec / 60,
      watts: wattSec / sec
    });
    i = j;
  }

  // slowest first, then drop any window that overlaps one already taken
  const picked: SlowWindow[] = [];
  for (const w of [...windows].sort((a, b) => a.kph - b.kph)) {
    if (picked.some((p) => w.fromKm < p.toKm && w.toKm > p.fromKm)) continue;
    picked.push(w);
    if (picked.length >= count) break;
  }
  return picked.sort((a, b) => a.km - b.km); // report them in route order
}

/** Format a minutes-past-midnight clock value as HH:MM. */
export function clockOf(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
}

/** Format a duration in seconds as `Nh MMm`, carrying 59.6 min into the next hour. */
export function durationOf(sec: number): string {
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (m === 60) return `${h + 1}h 00m`;
  return h === 0 ? `${m}m` : `${h}h ${String(m).padStart(2, '0')}m`;
}