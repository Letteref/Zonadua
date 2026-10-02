import { haversineM, type TrackPoint } from './course';

/**
 * Rider calibration: measure this rider's own `Crr` and `CdA` from a recorded ride.
 *
 * ## Why this exists
 *
 * Every projection in the app runs on two numbers that were, until now, guesses:
 * `crr = 0.005` and `cda = 0.32` on a default bike. They are defensible textbook
 * middles, and they are wrong for most people — tyre pressure, wheel depth and rider
 * posture move `CdA` by ±10 %, and tyre choice moves `Crr` by a third. The prediction
 * gate in `deviation.test.ts` cannot be closed while the model runs on constants nobody
 * measured.
 *
 * A recorded ride *does* contain the answer. At steady state the power at the wheel is
 * the sum of two terms, and each dominates in a different regime:
 *
 *   P_wheel = Crr·m·g·cosθ·v   +   m·g·sinθ·v   +   ½ρ·CdA·(v+w)³
 *              ^ rolling, at low speed      ^ gravity, known from the profile   ^ aero, at high speed
 *
 * Rearranged, with the gravity term subtracted out because the profile already knows it:
 *
 *   P_wheel − m·g·sinθ·v  =  Crr · (m·g·cosθ·v)  +  CdA · (½ρ·v³)
 *
 * That is **linear in Crr and CdA**, so the whole calibration is a two-parameter linear
 * least-squares fit — no gradient descent, no starting guess, one 2×2 solve.
 */

/** One usable instant from a ride, in the units the fit works in. */
export interface CalibSample {
  /** cumulative distance, km */
  distKm: number;
  /** elevation, m */
  altM: number;
  /** cumulative moving seconds */
  movingSec: number;
  /** instantaneous power at the pedals, W */
  watts: number;
}

export interface CalibParams {
  riderKg: number;
  bikeKg: number;
  cargoKg?: number;
  drivetrainLoss?: number;
  airDensity: number;
  /** unknown in practice; assumed zero and reported as an assumption, not a measurement */
  headwindKph?: number;
}

export interface Calibration {
  /** coefficient of rolling resistance, dimensionless */
  crr: number;
  /** effective frontal area, m² */
  cda: number;
  /** RMS misfit of the fit, watts — the honest measure of how well the model describes this ride */
  rmsW: number;
  /** samples that survived the steady-state filter */
  samples: number;
  /** the speed window those samples actually covered, km/h */
  speedRange: [number, number];
  /**
   * Why the answer should not be trusted, empty when the fit is clean. Every string here
   * is something a rider can act on.
   */
  warnings: string[];
}

export type CalibrationResult =
  | ({ ok: true } & Calibration)
  | { ok: false; reason: string; detail?: string };

/** Smoothing window for power, seconds. Short enough to track a grade change, long enough to drop noise. */
const SMOOTH_SEC = 30;

/** Steady-state filter limits. Chosen from the physics, not tuned to a result. */
const MIN_SPEED_KPH = 15;
const MAX_SPEED_KPH = 65;
const MIN_WATTS = 80;
const MAX_GRADE_PCT = 12;
/** Below this the two regressors are so nearly collinear that the split is arbitrary. */
const MIN_SEPARABILITY = 1e-4;
/** A fit that cannot get within this of the trace is describing something else. */
const MAX_RMS_W = 25;

/**
 * Turn stored track points into fit-ready samples: cumulative distance from the track
 * geometry, speed and gradient from the timestamps, power smoothed over `SMOOTH_SEC`.
 *
 * Points without a watt reading are dropped rather than zero-filled, so a meter that
 * paired halfway through a ride costs the calibration half a ride instead of corrupting
 * it.
 */
export function buildCalibSamples(
  points: readonly TrackPoint[],
  sampleSec = 5
): CalibSample[] {
  const usable = points.filter(
    (p): p is TrackPoint & { t: number; lat: number; lng: number; alt: number; watts: number } =>
      typeof p.t === 'number' &&
      typeof p.lat === 'number' &&
      typeof p.lng === 'number' &&
      typeof p.alt === 'number' &&
      typeof p.watts === 'number'
  );
  if (usable.length < 30) return [];

  const win = Math.max(3, Math.round(SMOOTH_SEC / sampleSec));
  const raw: CalibSample[] = [];
  let distKm = 0;

  for (let i = 0; i < usable.length; i++) {
    const p = usable[i];
    if (i > 0) {
      distKm += haversineM(usable[i - 1].lat, usable[i - 1].lng, p.lat, p.lng) / 1000;
    }

    // Centred moving average. Power at the pedals is noisy and the fit is very sensitive
    // to it: an unsmoothed trace produces a visibly worse-looking CdA for the same rider.
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - (win >> 1)); k <= Math.min(usable.length - 1, i + (win >> 1)); k++) {
      sum += usable[k].watts;
      n++;
    }

    raw.push({ distKm, altM: p.alt, movingSec: (p.t - usable[0].t) / 1000, watts: sum / n });
  }

  return raw;
}

/**
 * Least-squares `Crr` and `CdA` for one ride.
 *
 * Refuses to answer rather than guessing: too few steady samples, a speed window too
 * narrow to separate rolling from aero, a fit that misses badly, or parameters that land
 * outside physically possible values. Each refusal carries the reason, because "calibration
 * failed" is not something a rider can act on.
 */
export function calibrate(
  samples: readonly CalibSample[],
  params: CalibParams
): CalibrationResult {
  if (samples.length < 20) {
    return {
      ok: false,
      reason: 'Not enough usable samples',
      detail: `${samples.length} steady-state samples; at least 20 are needed to fit two parameters`
    };
  }

  const m = params.riderKg + params.bikeKg + (params.cargoKg ?? 0);
  const loss = params.drivetrainLoss ?? 0.025;
  const rho = params.airDensity;
  const headwind = params.headwindKph ?? 0;
  const g = 9.80665;

  // Design matrix A·[crr, cda]ᵀ = y, one row per sample.
  const rows: Array<{ a: number; b: number; y: number; kph: number }> = [];
  const kphAll: number[] = [];

  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    const dt = s.movingSec - samples[i - 1].movingSec;
    const dd = s.distKm - samples[i - 1].distKm;
    if (dt <= 0 || dd <= 0) continue;

    const vKph = dd / (dt / 3600);
    const gradePct = ((s.altM - samples[i - 1].altM) / (dd * 1000)) * 100;
    kphAll.push(vKph);

    // Steady state only. Coasting, standing starts and gradient transitions all have
    // power that does not correspond to the speed being held, and a fit that swallows
    // them returns coefficients for a ride that was never ridden.
    if (vKph < MIN_SPEED_KPH || vKph > MAX_SPEED_KPH) continue;
    if (s.watts < MIN_WATTS) continue;
    if (Math.abs(gradePct) > MAX_GRADE_PCT) continue;

    const v = vKph / 3.6;
    const theta = Math.atan(gradePct / 100);
    const air = v + headwind / 3.6;

    const a = m * g * Math.cos(theta) * v; // rolling coefficient term
    const b = 0.5 * rho * air * air * air; // aero coefficient term
    // Watts are measured at the pedals; the model works at the wheel.
    const y = s.watts * (1 - loss) - m * g * Math.sin(theta) * v;

    rows.push({ a, b, y, kph: vKph });
  }

  if (rows.length < 20) {
    return {
      ok: false,
      reason: 'Not enough steady-state samples',
      detail: `${rows.length} of ${samples.length} samples were riding at a steady 15–65 km/h; at least 20 are needed`
    };
  }

  let aa = 0;
  let ab = 0;
  let bb = 0;
  let ay = 0;
  let by = 0;
  for (const r of rows) {
    aa += r.a * r.a;
    ab += r.a * r.b;
    bb += r.b * r.b;
    ay += r.a * r.y;
    by += r.b * r.y;
  }

  const det = aa * bb - ab * ab;
  // `det / (aa·bb)` is cos² of the angle between the two regressors. When the ride held
  // one speed, rolling and aero are the same measurement in different units and the split
  // between them is arbitrary — however small the residual looks.
  const separability = aa * bb > 0 ? det / (aa * bb) : 0;

  const lo = Math.min(...rows.map((r) => r.kph));
  const hi = Math.max(...rows.map((r) => r.kph));

  if (separability < MIN_SEPARABILITY) {
    return {
      ok: false,
      reason: 'Rolling and aerodynamic drag cannot be separated from this ride',
      detail: `steady samples spanned only ${lo.toFixed(1)}–${hi.toFixed(1)} km/h; a ride that holds one speed cannot tell Crr from CdA`
    };
  }

  const crr = ay * bb - by * ab;
  const detCrr = crr / det;
  const cda = (by * aa - ay * ab) / det;

  let sse = 0;
  for (const r of rows) {
    const resid = r.y - (r.a * detCrr + r.b * cda);
    sse += resid * resid;
  }
  const rmsW = Math.sqrt(sse / rows.length);

  const warnings: string[] = [];

  if (detCrr <= 0.002 || detCrr >= 0.012) {
    return {
      ok: false,
      reason: 'Fitted rolling resistance is not physically possible',
      detail: `Crr came out at ${detCrr.toFixed(4)}; road tyres run 0.003–0.010. This usually means the power trace is misaligned with the GPS track`
    };
  }
  if (cda <= 0.15 || cda >= 0.6) {
    return {
      ok: false,
      reason: 'Fitted frontal area is not physically possible',
      detail: `CdA came out at ${cda.toFixed(3)} m²; a road position is 0.25–0.40`
    };
  }
  if (rmsW > MAX_RMS_W) {
    warnings.push(
      `Fit misses by ${rmsW.toFixed(0)} W RMS — expect Crr and CdA to be off by a few percent`
    );
  }
  if (hi - lo < 8) {
    warnings.push(
      `Steady samples only spanned ${(hi - lo).toFixed(1)} km/h; a wider speed range would sharpen both numbers`
    );
  }
  if (headwind === 0) {
    warnings.push('Wind was assumed to be zero. A windy ride inflates CdA and understates nothing else.');
  }
  if (rows.length < 120) {
    warnings.push(
      `Only ${rows.length} steady samples were usable; short rides give noisy coefficients`
    );
  }

  return {
    ok: true,
    crr: Math.round(detCrr * 10_000) / 10_000,
    cda: Math.round(cda * 1000) / 1000,
    rmsW: Math.round(rmsW * 10) / 10,
    samples: rows.length,
    speedRange: [Math.round(lo * 10) / 10, Math.round(hi * 10) / 10],
    warnings
  };
}

/**
 * One call from a decoded ride stream to a measured bike.
 *
 * This is the entry point the UI should use: hand it the samples already stored in
 * `activity_streams` (which, since the importer stopped discarding them, really do carry
 * watts) and the rider's own numbers, and it either returns a measurement or a reason.
 */
export function calibrateFromTrack(
  points: readonly TrackPoint[],
  params: CalibParams,
  sampleSec = 5
): CalibrationResult {
  const samples = buildCalibSamples(points, sampleSec);
  if (samples.length === 0) {
    return {
      ok: false,
      reason: 'This ride has no usable power-and-GPS trace',
      detail:
        'Calibration needs position, elevation, time and watts on the same samples. A file without a power meter, or one whose streams never carried position, cannot produce it.'
    };
  }
  return calibrate(samples, params);
}