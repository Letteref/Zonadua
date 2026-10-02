/**
 * Domain metrics — ARCHITECTURE.md §5.1 (F1).
 *
 * Pure functions, zero dependencies, zero browser APIs: every number the UI shows as
 * "performance" must come from here, never from a hardcoded assumption.
 *
 * Conventions (TrainingPeaks / Coggan):
 *   NP  = ( mean( mean(30 s rolling power)^4 ) )^(1/4)
 *   IF  = NP / FTP  (FTP resolved from the history by activity date)
 *   TSS = hours × IF² × 100
 *   kJ  = meanPower × hours,  kcal = kJ / 4.184
 */

export interface FtpPoint {
  /** ISO date (YYYY-MM-DD) */
  date: string;
  ftp: number;
}

/** Rolling-average window for Normalized Power, in seconds. */
export const NP_WINDOW_SEC = 30;

/**
 * Version of the metric pipeline that produced an activity's stored np/if/tss.
 * Bump whenever the formulas change; stored rows carrying a different version are
 * recomputed from their power trace on next launch (see lib/data/recompute.ts).
 */
export const METRICS_VERSION = 1;

/** 1 kcal = 4.184 kJ. */
export const KJ_PER_KCAL = 4.184;

/**
 * Normalized Power from a power trace.
 *
 * Steps: 30 s rolling mean power → raise each mean to the 4th power → average → 4th root.
 * Negative (regen) samples are clamped to 0: a generator-assisted descent must not
 * cancel the rider's work.
 *
 * Rides shorter than the window collapse to a single window covering the whole ride,
 * so a 60 s sprint still yields a sensible NP instead of NaN.
 */
export function normalizedPower(watts: readonly number[], sampleSec = 1): number {
  const n = watts.length;
  if (n === 0) return 0;

  const win = Math.max(1, Math.round(NP_WINDOW_SEC / sampleSec));

  // A single window collapses the formula to the plain mean power: (m⁴)^¼ = m.
  if (n < win) return mean(watts);

  // Rolling sum of power, then raise each window *mean* to the 4th power.
  let acc = 0;
  for (let i = 0; i < win; i++) acc += clampWatts(watts[i]);

  let fourthSum = (acc / win) ** 4;
  let count = 1;

  for (let start = 1; start + win <= n; start++) {
    acc += clampWatts(watts[start + win - 1]) - clampWatts(watts[start - 1]);
    fourthSum += (acc / win) ** 4;
    count++;
  }

  return fourthRoot(fourthSum / count);
}

/** Intensity Factor = NP / FTP. Returns 0 when FTP is unknown (never divide by 0). */
export function intensityFactor(np: number, ftp: number): number {
  if (!Number.isFinite(np) || !Number.isFinite(ftp) || ftp <= 0) return 0;
  return np / ftp;
}

/** Training Stress Score for a completed interval of `hours` at intensity `ifValue`. */
export function trainingStressScore(hours: number, ifValue: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  if (!Number.isFinite(ifValue) || ifValue <= 0) return 0;
  return hours * ifValue * ifValue * 100;
}

/** Mechanical work in kilojoules: meanPower (W) × hours. */
export function kilojoules(watts: readonly number[], sampleSec = 1): number {
  if (watts.length === 0) return 0;
  return (mean(watts) * watts.length * sampleSec) / 1000;
}

/** kJ → kcal. */
export function kjToKcal(kj: number): number {
  return kj / KJ_PER_KCAL;
}

/**
 * FTP in force on a given date (ARCHITECTURE §5.1: "FTP berlaku sesuai tanggal aktivitas").
 * Picks the most recent measurement on or before that date; falls back to the earliest
 * known value so pre-history activities still resolve instead of dividing by zero.
 */
export function ftpOnDate(history: readonly FtpPoint[], dateIso: string): number {
  if (history.length === 0) return 0;
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const day = dateIso.slice(0, 10);
  let resolved = sorted[0].ftp;
  for (const p of sorted) {
    if (p.date <= day) resolved = p.ftp;
    else break;
  }
  return resolved;
}

export interface RideMetrics {
  /** normalized power (W) */
  np: number;
  /** intensity factor */
  if: number;
  /** training stress score */
  tss: number;
  /** mechanical work (kJ) */
  kj: number;
  /** derived energy cost (kcal) */
  kcal: number;
  /** mean power (W) */
  avgPower: number;
  /** max power (W) */
  maxPower: number;
  /** FTP used for the IF computation */
  ftp: number;
}

/**
 * Full metric set for one power trace. `movingSec` defaults to the trace length so a
 * trace with dropped samples still scores against real elapsed time, not sample count.
 */
export function rideMetrics(
  watts: readonly number[],
  ftp: number,
  sampleSec = 1,
  movingSec = watts.length * sampleSec
): RideMetrics {
  const np = normalizedPower(watts, sampleSec);
  const ifValue = intensityFactor(np, ftp);
  return {
    np,
    if: ifValue,
    tss: trainingStressScore(movingSec / 3600, ifValue),
    kj: kilojoules(watts, sampleSec),
    kcal: kjToKcal(kilojoules(watts, sampleSec)),
    avgPower: Math.round(mean(watts)),
    maxPower: watts.length === 0 ? 0 : Math.max(...watts.map(clampWatts)),
    ftp
  };
}

// ---------- internals ----------

function clampWatts(w: number): number {
  if (!Number.isFinite(w)) return 0;
  return w < 0 ? 0 : w;
}

function mean(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) sum += clampWatts(v);
  return sum / values.length;
}

function fourthRoot(x: number): number {
  return x <= 0 ? 0 : x ** 0.25;
}