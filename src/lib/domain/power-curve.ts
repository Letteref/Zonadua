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

import { archetype, type ArchetypeKey } from './onboarding';

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

/** Where the CP/W′ pair a judgement rests on came from. */
export type CpFitSource = 'measured' | 'entered';

export interface ResolvedCpFit {
  fit: CriticalPowerFit;
  /**
   * `measured` — fitted from the rider's own power curves.
   * `entered` — the pair the rider typed in themselves; a statement, not evidence.
   */
  source: CpFitSource;
}

/**
 * The CP/W′ pair to judge a ride against: a fit when there is a curve, the rider's own
 * typed pair when there is not.
 *
 * The two are not interchangeable, so the source travels with the fit and every surface
 * has to say which one it got. A fit is measured — `points` durations from real rides,
 * with an `r2` for how well the model matched. An entered pair is stated: many riders
 * know CP/W′ from a lab test or another app, and no amount of arithmetic will pull two
 * parameters out of a mean-max curve that does not exist. It reports `points: 0` and
 * `r2: 0`, so nothing downstream can mistake it for a fit, and the capability card
 * prints "entered in Settings, not fitted" instead of inventing provenance.
 *
 * A measured fit always wins when one exists: the rider's own rides are better evidence
 * than a number typed from memory, however carefully it was typed.
 */
export function resolveCpFit(
  curves: readonly (readonly CurvePoint[])[],
  entered?: { cp: number; wPrime: number }
): ResolvedCpFit | undefined {
  const merged = mergePowerCurves(curves);
  if (merged.length >= 4) {
    const fit = fitCriticalPower(merged);
    if (fit) return { fit, source: 'measured' };
  }
  if (entered && entered.cp > 0 && entered.wPrime > 0) {
    return {
      fit: {
        cp: Math.round(entered.cp),
        wPrime: Math.round(entered.wPrime),
        r2: 0,
        points: 0,
        predicted: []
      },
      source: 'entered'
    };
  }
  return undefined;
}

/**
 * A starting pair for the rider who owns no power meter.
 *
 * Two parameters cannot be pulled out of a mean-max curve that does not exist, so both are
 * arithmetic on numbers the rider does have:
 *
 *  - CP sits a little under the hour power most riders mean by FTP (0.95).
 *  - W′ is an anaerobic tank, so it tracks body size and how much high-intensity work the
 *    rider does — not one constant for everybody. It is scaled per kilo off the training
 *    tier the rider picked at onboarding (see `W_PRIME_J_PER_KG`), then clamped to the
 *    range real riders occupy.
 *
 * Nothing measured it, so the result is a suggestion for the fields, not a fit: the
 * settings form prefills them and says where the numbers came from, and whatever the
 * rider saves is stored as *their* stated pair (`resolveCpFit` reports it as `entered`).
 * Returns undefined when there is no FTP to work from — a guess with no input is a guess.
 */
export const CP_FROM_FTP_RATIO = 0.95;

/**
 * Anaerobic work capacity per kilo of rider, by training tier.
 *
 * The tiers are the ones the onboarding picker already asks about, so "what kind of riding
 * do you do" answers a question the estimate needs instead of a second prompt. A rank
 * beginner holds roughly 170 J/kg, a rider training with structure ~210, and a racer with
 * repeated above-threshold work ~250. Weight matters too: two riders of the same tier
 * differ mostly by how much tissue is doing the work.
 */
export const W_PRIME_J_PER_KG: Record<ArchetypeKey, number> = {
  foundation: 170,
  structured: 210,
  performance: 250
};

/** Nobody to weigh? Assume a mid-size rider rather than skipping the estimate entirely. */
export const DEFAULT_RIDER_WEIGHT_KG = 70;

/** The band real riders occupy; anything outside it is arithmetic, not physiology. */
export const W_PRIME_MIN_J = 8_000;
export const W_PRIME_MAX_J = 24_000;

/**
 * W′ from body mass and training tier, in joules, rounded to the nearest 100 J.
 *
 * An unknown or unusable weight falls back to `DEFAULT_RIDER_WEIGHT_KG`; an unknown tier
 * falls back to the middle band (`archetype()` already does that). The result never leaves
 * `[W_PRIME_MIN_J, W_PRIME_MAX_J]`. Callers that print the number should say it was
 * assumed — `estimateCpWFromFtp` reports that alongside the pair.
 */
export function estimateWPrimeFromBody(
  weightKg?: number | null,
  archetypeKey?: string | null
): number {
  const tier = archetype(archetypeKey ?? '').key;
  const kg = weightKg != null && Number.isFinite(weightKg) && weightKg > 0 ? weightKg : DEFAULT_RIDER_WEIGHT_KG;
  const raw = W_PRIME_J_PER_KG[tier] * kg;
  const clamped = Math.min(W_PRIME_MAX_J, Math.max(W_PRIME_MIN_J, raw));
  return Math.round(clamped / 100) * 100;
}

export interface CpEstimate {
  cp: number;
  wPrime: number;
  /** the body mass the W′ used, in kg */
  weightKg: number;
  /** true when that mass was the default rather than the rider's own */
  weightAssumed: boolean;
  /** the tier the J/kg figure came from */
  archetype: ArchetypeKey;
}

export function estimateCpWFromFtp(
  ftpW: number | undefined | null,
  body?: { weightKg?: number | null; archetype?: string | null }
): CpEstimate | undefined {
  if (ftpW == null || !Number.isFinite(ftpW) || ftpW <= 0) return undefined;
  const weightAssumed = body?.weightKg == null || !Number.isFinite(body.weightKg) || body.weightKg <= 0;
  const tier = archetype(body?.archetype ?? '').key;
  return {
    cp: Math.round(ftpW * CP_FROM_FTP_RATIO),
    wPrime: estimateWPrimeFromBody(body?.weightKg, tier),
    weightKg: weightAssumed ? DEFAULT_RIDER_WEIGHT_KG : Math.round(body!.weightKg! * 10) / 10,
    weightAssumed,
    archetype: tier
  };
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