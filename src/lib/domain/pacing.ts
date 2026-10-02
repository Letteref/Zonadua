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