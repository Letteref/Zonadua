/**
 * Cycling physics: power → speed — ARCHITECTURE.md §5.3 (F6).
 *
 * Pure functions, no dependencies. Given an elevation profile, the rider+load mass and
 * the available power, this solves the speed of every segment instead of dividing
 * distance by a constant guess.
 *
 *   P_wheel = P_gravity + P_rolling + P_aero
 *   P_gravity = m·g·v·sin(atan(grade))
 *   P_rolling = Crr·m·g·cos(atan(grade))·v
 *   P_aero    = ½·ρ·CdA·(v+w)³          (w = headwind, positive against travel)
 *   P_rider   = P_wheel / (1 − drivetrain loss)
 *
 * Required power rises monotonically with speed, so a bisection on [v_min, v_max] is both
 * exact enough and unconditionally stable — no solver can diverge on a steep wall.
 */

export const GRAVITY = 9.80665; // m/s²

export interface ProfilePoint {
  /** distance from the start, in km */
  distKm: number;
  /** elevation above sea level, in m */
  altM: number;
}

export interface PhysicsParams {
  /** rider body mass, kg */
  riderKg: number;
  /** bike + accessories, kg */
  bikeKg: number;
  /** carried load, kg (race nutrition, bags) */
  cargoKg?: number;
  /** coefficient of rolling resistance */
  crr: number;
  /** effective frontal area, m² */
  cda: number;
  /** drivetrain loss fraction (0.025 ≈ 2.5% for a clean chain) */
  drivetrainLoss?: number;
  /** air density kg/m³; derived from altitude/temperature when omitted */
  airDensity?: number;
  /** ambient temperature °C, used only when airDensity is omitted */
  temperatureC?: number;
  /** altitude used for the density constant when solving a single gradient, m */
  referenceAltitudeM?: number;
  /** headwind in km/h, positive against the direction of travel */
  headwindKph?: number;
  /** stall speed floor, km/h */
  vMinKph?: number;
  /** descent speed cap, km/h */
  vMaxKph?: number;
}

export interface Segment {
  /** segment index */
  i: number;
  distKm: number;
  /** elevation at the end of the segment */
  altM: number;
  /** rise over the segment, m */
  riseM: number;
  /** gradient as a percentage (positive = uphill) */
  gradePct: number;
  vKph: number;
  /** time for this segment only */
  sec: number;
  cumDistKm: number;
  cumTimeSec: number;
  /**
   * true when the rider cannot hold the target speed even at the stall floor —
   * the climb is out of range and the speed is a crawl, not a prediction.
   */
  powerLimited: boolean;
  /**
   * watts that would actually be required at this speed; differs from the target on
   * steep climbs and descents (on a descent the rider has surplus power in hand).
   */
  powerUsedW: number;
}

export interface RideSolution {
  segments: Segment[];
  totalTimeSec: number;
  totalDistKm: number;
  climbM: number;
  descentM: number;
  avgKph: number;
  /** segments where the rider ran out of gears */
  powerLimitedCount: number;
  /** share of the distance the rider cannot hold the target power over, 0–100 */
  powerLimitedPct: number;
  /**
   * Power needed to hold a minimum sane climbing speed on the steepest gradient of the
   * route. Above the rider's FTP means this wall is not rideable at the target power.
   */
  peakRequiredW: number;
}

/**
 * Standard-atmosphere density at an altitude.
 * Barometric formula with the 6.5 K/km lapse rate; exponent g·M/(R·L) = 5.25588.
 * `temperatureC` is the temperature at sea level — the local temperature falls with
 * altitude and the ideal-gas law has to use the local one.
 */
export function airDensity(altM: number, temperatureC = 20): number {
  const tSea = 273.15 + temperatureC;
  const tLocal = tSea - 0.0065 * altM;
  const p = 101_325 * Math.pow(tLocal / tSea, 5.25588);
  return p / (287.05 * tLocal);
}

export const totalMass = (p: PhysicsParams): number => p.riderKg + p.bikeKg + (p.cargoKg ?? 0);

/** Density for a single-gradient solve: explicit override, else standard atmosphere. */
export const densityOf = (p: PhysicsParams): number =>
  p.airDensity ?? airDensity(p.referenceAltitudeM ?? 0, p.temperatureC ?? 20);

/**
 * Rider power required to hold `vKph` on a gradient of `gradePct`, in watts.
 * This is the forward model the solver inverts.
 */
export function requiredPower(
  params: PhysicsParams,
  gradePct: number,
  vKph: number,
  density = densityOf(params)
): number {
  const v = vKph / 3.6;
  const air = v + (params.headwindKph ?? 0) / 3.6;
  const theta = Math.atan(gradePct / 100);
  const m = totalMass(params);

  const gravity = m * GRAVITY * v * Math.sin(theta);
  const rolling = params.crr * m * GRAVITY * Math.cos(theta) * v;
  const aero = 0.5 * density * params.cda * air * air * air;
  const wheel = gravity + rolling + aero;
  return wheel / (1 - (params.drivetrainLoss ?? 0.025));
}

/**
 * Speed the rider actually achieves on this gradient with `targetWatts`.
 * Bisection on [vMin, vMax] — the only two honest answers when the target is unreachable
 * (crawl) or surplus (descent cap) are returned explicitly rather than silently.
 */
export function solveSpeed(
  params: PhysicsParams,
  gradePct: number,
  targetWatts: number,
  density = densityOf(params)
): { vKph: number; powerLimited: boolean; powerUsedW: number } {
  const vMin = params.vMinKph ?? 5;
  const vMax = params.vMaxKph ?? 65;

  if (requiredPower(params, gradePct, vMin, density) > targetWatts) {
    return { vKph: vMin, powerLimited: true, powerUsedW: requiredPower(params, gradePct, vMin, density) };
  }
  if (requiredPower(params, gradePct, vMax, density) <= targetWatts) {
    return { vKph: vMax, powerLimited: false, powerUsedW: requiredPower(params, gradePct, vMax, density) };
  }

  let lo = vMin;
  let hi = vMax;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (requiredPower(params, gradePct, mid, density) > targetWatts) hi = mid;
    else lo = mid;
  }
  const vKph = (lo + hi) / 2;
  return { vKph, powerLimited: false, powerUsedW: targetWatts };
}

/**
 * Resample a sparse elevation profile into uniform distance steps.
 * Constant grade per step then costs almost nothing in accuracy and makes the
 * per-segment table meaningful instead of spanning 20 km per row.
 */
export function resampleProfile(points: readonly ProfilePoint[], stepM = 100): ProfilePoint[] {
  if (points.length < 2) return [...points];
  const sorted = [...points].sort((a, b) => a.distKm - b.distKm);
  const out: ProfilePoint[] = [];

  // Each span contributes its start point and everything up to (but not including) its
  // end; the final point is appended once at the end. Including the end here would drop
  // every interior vertex, and the elevation change across a vertex is real terrain.
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const spanM = (b.distKm - a.distKm) * 1000;
    if (spanM <= 0) continue;
    const steps = Math.max(1, Math.round(spanM / stepM));
    for (let k = 0; k < steps; k++) {
      const f = k / steps;
      out.push({ distKm: a.distKm + (b.distKm - a.distKm) * f, altM: a.altM + (b.altM - a.altM) * f });
    }
  }
  out.push(sorted.at(-1)!);
  return out;
}

/** Walk the profile at a constant power target and solve the speed of every step. */
export function solveRide(
  profile: readonly ProfilePoint[],
  params: PhysicsParams,
  targetWatts: number,
  stepM = 100
): RideSolution {
  const pts = resampleProfile(profile, stepM);
  const segments: Segment[] = [];
  let cumTimeSec = 0;
  let cumDistKm = 0;
  let climbM = 0;
  let descentM = 0;
  let powerLimitedCount = 0;
  let powerLimitedKm = 0;
  let steepestGradePct = 0;
  /**
   * Altitude where that steepest ramp *is*, kept so the headline figure can be evaluated in
   * the same air the segment rides in. `null` until a positive grade is seen — a route with
   * no climb has no altitude to derive a density from, and `peakRequiredW` then falls back
   * to the caller's own reference altitude rather than inventing one.
   */
  let steepestAltM: number | null = null;

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const segKm = b.distKm - a.distKm;
    if (segKm <= 0) continue;

    const riseM = b.altM - a.altM;
    const gradePct = (riseM / (segKm * 1000)) * 100;
    // air thins with altitude, so density is per-segment rather than one global constant
    const density = params.airDensity ?? airDensity(b.altM, params.temperatureC ?? 20);
    const { vKph, powerLimited, powerUsedW } = solveSpeed(params, gradePct, targetWatts, density);
    // km ÷ (km/h) → hours → seconds. Dividing km/h by 3.6 gives m/s, not km/s.
    const sec = segKm / (vKph / 3600);

    if (riseM > 0) climbM += riseM;
    else descentM += -riseM;
    if (powerLimited) {
      powerLimitedCount++;
      powerLimitedKm += segKm;
    }
    if (gradePct > steepestGradePct) {
      steepestGradePct = gradePct;
      steepestAltM = b.altM;
    }
    cumTimeSec += sec;
    cumDistKm += segKm;

    segments.push({
      i: segments.length,
      distKm: b.distKm,
      altM: b.altM,
      riseM,
      gradePct,
      vKph,
      sec,
      cumDistKm,
      cumTimeSec,
      powerLimited,
      powerUsedW
    });
  }

  const totalTimeSec = cumTimeSec;
  return {
    segments,
    totalTimeSec,
    totalDistKm: cumDistKm,
    climbM,
    descentM,
    avgKph: totalTimeSec > 0 ? (cumDistKm / (totalTimeSec / 3600)) : 0,
    powerLimitedCount,
    powerLimitedPct: cumDistKm > 0 ? Math.round((powerLimitedKm / cumDistKm) * 1000) / 10 : 0,
    // One evaluation on the steepest ramp, at a speed a racer would actually hold on a climb.
    //
    // The density has to be the air *at that ramp*. This used to call `densityOf(params)`,
    // which falls back to `referenceAltitudeM ?? 0` — and since no caller ever sets
    // `referenceAltitudeM`, that was always sea level. Every segment in this same loop was
    // solved at its own altitude, so the headline figure was the one number on the card not
    // describing the ride it was describing.
    //
    // How much it was wrong is worth stating precisely, because it is easy to overstate: air
    // at 2,000 m really is ~18 % thinner, but a 10 % wall held at 15 km/h is dominated by the
    // gravity term — aero is only ~4 % of the total there — so the correction is about 1 %
    // (3 W in the measured case). Small, but it was a real inconsistency, not a rounding one,
    // and it grew with the wall's altitude and its speed.
    peakRequiredW: Math.round(
      requiredPower(
        params,
        steepestGradePct,
        15,
        params.airDensity ??
          airDensity(
            steepestAltM ?? params.referenceAltitudeM ?? 0,
            params.temperatureC ?? 20
          )
      )
    )
  };
}

/**
 * Inverse of the solver: what power does this rider need to hold `vKph` here?
 * Used by the race projection (M4) to answer "can I make the cut-off?".
 */
export function powerForSpeed(params: PhysicsParams, gradePct: number, vKph: number): number {
  return requiredPower(params, gradePct, vKph);
}

/** Rough energy cost of a ride, for the nutrition hint. */
export function kilojoulesForRide(solution: RideSolution): number {
  return solution.segments.reduce((a, s) => a + (s.powerUsedW * s.sec) / 1000, 0);
}