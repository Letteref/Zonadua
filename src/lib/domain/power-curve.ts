/**
 * Mean-maximal power curve + Critical Power model — ARCHITECTURE.md §5.1 (F1).
 *
 * Pure functions, no dependencies. Two jobs:
 *   1. Mean-maximal curve: the highest average power the athlete held for each duration,
 *      taken as the element-wise maximum across activities.
 *   2. CP/W' fit: the three-parameter minimal model P(t) = W'/t + CP, solved with
 *      Gauss-Newton (damped, bounded, grid-seeded so it cannot diverge).
 *
 * The W' balance left in the tank at time t is W'(1 − t/t_lim), where t_lim = W'/(W'·0 + CP).
 * That is what the race feasibility check (M4) will consume.
 */

/** Canonical durations, in seconds: short efforts then long efforts (ARCHITECTURE §5.1). */
export const CURVE_DURATIONS_SEC: readonly number[] = Object.freeze([
  1, 5, 10, 15, 20, 30, 45, 60, 120, 180, 240, 300, 390, 600,
  5 * 60, 8 * 60, 10 * 60, 15 * 60, 20 * 60, 30 * 60, 40 * 60, 60 * 60,
  90 * 60, 120 * 60, 180 * 60, 240 * 60, 300 * 60, 360 * 60, 480 * 60, 600 * 60, 720 * 60
]);

/**
 * Durations used to fit CP/W'. Short efforts are excluded on purpose: a 5-second spike
 * says nothing about the W' pool and drags the asymptote.
 */
export const FIT_MIN_DURATION_SEC = 120;

export interface CurvePoint {
  durationSec: number;
  watts: number;
}

/**
 * Version of the curve pipeline that produced a stored `power_curves` row.
 * Bump whenever mean-max or the fit changes; mismatched rows are recomputed on launch.
 */
export const CURVE_VERSION = 1;

export interface CriticalPowerFit {
  /** critical power (W) — the asymptote */
  cp: number;
  /** W' (J) — the finite anaerobic work capacity */
  wPrime: number;
  /** coefficient of determination, 1 = perfect model match */
  r2: number;
  /** how many curve points fed the fit */
  points: number;
  /** model predictions, aligned with the input points */
  predicted: CurvePoint[];
}

/**
 * Mean-maximal power for each duration.
 *
 * Uses prefix sums so each duration is O(n) instead of O(n·window): a 3-hour trace at 5 s
 * sampling is 2160 samples, and the longest duration is 720 s → 1440 samples wide.
 * Partial trailing windows are ignored, matching the convention that a duration is only
 * valid if the athlete actually held it for the whole window.
 */
export function meanMaxPower(
  watts: readonly number[],
  sampleSec = 1,
  durations: readonly number[] = CURVE_DURATIONS_SEC
): CurvePoint[] {
  const n = watts.length;
  if (n === 0) return [];

  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + clamp(watts[i]);

  const out: CurvePoint[] = [];
  for (const durationSec of durations) {
    const windowSamples = Math.max(1, Math.round(durationSec / sampleSec));
    if (windowSamples > n) continue; // ride too short to hold this duration

    let best = 0;
    for (let s = 0; s + windowSamples <= n; s++) {
      const sum = prefix[s + windowSamples] - prefix[s];
      if (sum > best * windowSamples) best = sum / windowSamples;
    }
    out.push({ durationSec, watts: Math.round(best) });
  }
  return out;
}

/**
 * Merge per-activity curves into one athlete curve: the best mean-max seen at each
 * duration. Durations missing from every curve are dropped, so a set of short rides
 * yields a short curve rather than zeros.
 */
export function mergePowerCurves(curves: readonly (readonly CurvePoint[])[]): CurvePoint[] {
  const best = new Map<number, number>();
  for (const curve of curves) {
    for (const p of curve) {
      const prev = best.get(p.durationSec);
      if (prev === undefined || p.watts > prev) best.set(p.durationSec, p.watts);
    }
  }
  return [...best.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([durationSec, watts]) => ({ durationSec, watts }));
}

/**
 * Fit the critical power model P(t) = W'/t + CP.
 *
 * Grid seed → damped Gauss-Newton. Returns undefined when the curve is too thin to
 * identify two parameters, so the UI can honestly say "not enough data" instead of
 * printing a confident-looking CP from three noisy points.
 */
export function fitCriticalPower(curve: readonly CurvePoint[]): CriticalPowerFit | undefined {
  const pts = curve
    .filter((p) => p.durationSec >= FIT_MIN_DURATION_SEC && p.watts > 0)
    .sort((a, b) => a.durationSec - b.durationSec);
  if (pts.length < 3) return undefined;

  const t = pts.map((p) => p.durationSec);
  const y = pts.map((p) => p.watts);

  // ---- grid seed: cheap, deterministic, and immune to bad initial guesses ----
  const maxObserved = Math.max(...y);
  let cp = maxObserved;
  let w = 5000;
  let bestSse = Infinity;
  for (let ci = 0; ci < 40; ci++) {
    const cpTry = 40 + ci * (maxObserved - 20) / 40;
    for (let wi = 0; wi < 30; wi++) {
      const wTry = 1000 + wi * 1000;
      const sse = sseOf(cpTry, wTry, t, y);
      if (sse < bestSse) {
        bestSse = sse;
        cp = cpTry;
        w = wTry;
      }
    }
  }

  // ---- damped Gauss-Newton on the same two parameters ----
  let lambda = 1e-3;
  let sse = bestSse;
  for (let iter = 0; iter < 60; iter++) {
    // normal equations: [Σ1 Σ(1/t)][Δcp]   [Σr  Σ(r/t)]
    //                  [Σ(1/t) Σ(1/t²)][Δw] = [      Σ(r/t²)     ]
    let s00 = 0, s01 = 0, s11 = 0, b0 = 0, b1 = 0;
    for (let i = 0; i < t.length; i++) {
      const inv = 1 / t[i];
      const inv2 = inv * inv;
      const r = y[i] - (cp + w * inv);
      s00 += 1;
      s01 += inv;
      s11 += inv2;
      b0 += r;
      b1 += r * inv;
    }
    const det = s00 * s11 - s01 * s01;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-18) break;

    const dCp = (b0 * s11 - b1 * s01) / det;
    const dW = (s00 * b1 - s01 * b0) / det;

    // Levenberg-style damping: shrink the step while it fails to improve, grow it
    // once it succeeds. Keeps the solve stable on flat or noisy curves.
    const tryCp = cp + dCp;
    const tryW = w + dW;
    const trySse = tryCp > 0 && tryW > 0 ? sseOf(tryCp, tryW, t, y) : Infinity;
    if (trySse < sse) {
      cp = tryCp;
      w = tryW;
      lambda = Math.max(1e-6, lambda * 0.5);
      if (Math.abs(sse - trySse) < 1e-9) {
        sse = trySse;
        break;
      }
      sse = trySse;
    } else {
      lambda *= 4;
      if (lambda > 1e6) break;
    }
  }

  const mean = y.reduce((a, b) => a + b, 0) / y.length;
  const sst = y.reduce((a, b) => a + (b - mean) ** 2, 0);
  const r2 = sst > 0 ? Math.max(0, 1 - sse / sst) : 0;

  return {
    cp: Math.round(cp),
    wPrime: Math.round(w),
    r2: Math.round(r2 * 1000) / 1000,
    points: pts.length,
    predicted: t.map((durationSec) => ({
      durationSec,
      watts: Math.round(cp + w / durationSec)
    }))
  };
}

/** Time (s) at which W' is fully exhausted on the model curve. */
export function wPrimeExhaustionTime(fit: CriticalPowerFit): number {
  if (fit.cp <= 0) return 0;
  return fit.wPrime / fit.cp;
}

/** W' remaining (J) after riding for `seconds` on the model curve. */
export function wPrimeRemaining(fit: CriticalPowerFit, seconds: number): number {
  const tLim = wPrimeExhaustionTime(fit);
  if (tLim <= 0) return 0;
  if (seconds >= tLim) return 0;
  return fit.wPrime * (1 - seconds / tLim);
}

/** Linear interpolation of the curve at an arbitrary duration (for tooltips). */
export function curveValueAt(curve: readonly CurvePoint[], seconds: number): number | undefined {
  if (curve.length === 0) return undefined;
  const sorted = [...curve].sort((a, b) => a.durationSec - b.durationSec);
  if (seconds <= sorted[0].durationSec) return sorted[0].watts;
  const last = sorted.at(-1)!;
  if (seconds >= last.durationSec) return last.watts;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (seconds <= b.durationSec) {
      const f = (seconds - a.durationSec) / (b.durationSec - a.durationSec || 1);
      return Math.round(a.watts + f * (b.watts - a.watts));
    }
  }
  return last.watts;
}

function sseOf(cp: number, w: number, t: readonly number[], y: readonly number[]): number {
  let sse = 0;
  for (let i = 0; i < t.length; i++) {
    const r = y[i] - (cp + w / t[i]);
    sse += r * r;
  }
  return sse;
}

function clamp(w: number): number {
  if (!Number.isFinite(w)) return 0;
  return w < 0 ? 0 : w;
}