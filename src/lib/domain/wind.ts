/**
 * Wind as a number the solver can use.
 *
 * ## Why this is separate from the forecast fetch
 *
 * `fetch` is unreliable, rate-limited and occasionally returns a shape nobody expected.
 * The geometry here is not. Separating them means the arithmetic that decides whether a
 * headwind is a headwind can be tested exhaustively against fixtures, with no network
 * and no mocks — which is the only way to be sure the sign is right. A headwind that
 * arrives as a tailwind is worse than no forecast at all, because it makes a slow day
 * look fast.
 *
 * ## The convention, stated once
 *
 * Meteorological direction is where the wind blows *from*, in degrees clockwise from
 * north. The rider's bearing is where they travel *to*, same convention. The headwind
 * component is the projection of the wind vector onto the direction of travel, so a
 * wind blowing from dead ahead (both numbers equal) is a pure headwind, and a wind from
 * behind (differing by 180°) is a pure tailwind.
 */

const DEG = Math.PI / 180;

export interface WindSample {
  /** wind speed in km/h */
  speedKph: number;
  /** direction the wind blows FROM, degrees clockwise from north, [0, 360) */
  fromDeg: number;
}

export interface HeadwindInput {
  wind: WindSample | null;
  /** direction of travel, degrees clockwise from north */
  travelDeg: number;
}

/**
 * Signed headwind in km/h. Positive resists the rider, negative helps.
 *
 * Returns 0 when there is no wind rather than refusing: a caller that has no forecast
 * should get today's behaviour (no wind correction), and saying so is the caller's job
 * to display. What it must never do is invent a favourable direction, so an absent wind
 * resolves to still air, never to a tailwind.
 */
export function headwindKph(input: HeadwindInput): number {
  const w = input.wind;
  if (!w || !Number.isFinite(w.speedKph) || !Number.isFinite(w.fromDeg)) return 0;
  if (!Number.isFinite(input.travelDeg)) return 0;

  // angle between where the wind comes from and where the rider is going
  const delta = ((w.fromDeg - input.travelDeg + 540) % 360) - 180;
  const component = w.speedKph * Math.cos(delta * DEG);
  // cos is symmetric about 0, so a wind from ahead gives +speed and one from behind
  // gives -speed without a further flip
  return Math.round(component * 10) / 10;
}

/** Compass point for a bearing, used only for labelling in the UI. */
export function compass(deg: number): string {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  if (!Number.isFinite(deg)) return '—';
  return points[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

/**
 * The strongest headwind a forecast contains, with the hour it happens.
 *
 * Averages hide the thing that matters. A day of 8 km/h with one two-hour 35 km/h
 * headwind window is not an 8 km/h day, and that window is usually exactly when the
 * rider is on the exposed section with nothing in the bottle. `null` when the forecast
 * carries no usable speed, so the caller can say "no forecast" instead of drawing a bar
 * at zero.
 */
export function peakHeadwind(
  hours: readonly (WindSample | null)[],
  travelDeg: number
): { kph: number; hourIndex: number } | null {
  let best: { kph: number; hourIndex: number } | null = null;
  hours.forEach((h, i) => {
    const v = headwindKph({ wind: h, travelDeg });
    if (!best || v > best.kph) best = { kph: v, hourIndex: i };
  });
  return best;
}

/**
 * Initial bearing from one coordinate to another, degrees clockwise from north.
 *
 * Taken from the rider's own track rather than assumed. Returns `null` for a
 * zero-length or unresolvable segment — two identical GPS fixes have no direction, and
 * returning 0° there would point the rider due north and apply the wrong half of every
 * forecast.
 */
export function bearingBetween(lat1: number, lng1: number, lat2: number, lng2: number): number | null {
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const dLng = (lng2 - lng1) * DEG;
  const y = Math.sin(dLng) * Math.cos(lat2 * DEG);
  const x =
    Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) -
    Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos(dLng);
  if (y === 0 && x === 0) return null;
  return (((Math.atan2(y, x) / DEG) % 360) + 360) % 360;
}

/**
 * Two-iteration wind correction — ROADMAP M5 "2-iterasi koreksi".
 *
 * ## Why iterate at all
 *
 * Wind is forecast for a *time*, and the rider arrives at each part of the route at a
 * time the wind helped decide. Solving once against the wind at the start line uses the
 * 09:00 gust for a rider who reaches the exposed climb at 14:00. So: solve with no wind
 * to learn when the rider gets there, read the wind for *that* hour, re-solve. Two
 * passes is enough because the second solve shifts arrival by minutes, not hours.
 *
 * Stopping after one would use the wrong hour; iterating to convergence would be
 * pretending to a precision a 3-hourly forecast cannot deliver. The second pass's shift
 * is reported so the caller can say whether it mattered.
 *
 * `solve` receives the headwind for the hour currently being driven and returns the plan
 * it would produce; the caller supplies the real solver, so this stays free of physics
 * and is testable with arithmetic doubles.
 */
export function correctForWind<T>(input: {
  /** solve a plan given a headwind in km/h; 0 means still air */
  solve: (headwindKph: number) => T;
  /** the forecast hour that each plan arrives at */
  hourAt: (plan: T) => number;
  /** wind for a forecast hour, or null when the forecast has nothing there */
  windAt: (hour: number) => WindSample | null;
  /**
   * Direction of travel, degrees clockwise from north.
   *
   * Required, not defaulted. The first draft passed 0, which quietly computed the headwind
   * for a rider heading due north — a wrong-direction wind on a route heading south would
   * have arrived as a tailwind, making a slow day look fast. There is no safe default
   * bearing, so the caller has to supply one.
   */
  travelDeg: number;
  /** arrival moves less than this between passes and the correction is called stable */
  toleranceHours?: number;
}): {
  plan: T;
  headwindKph: number;
  /** hours arrival moved between the two passes; 0 when it was already stable */
  driftHours: number;
  /** true when a forecast was actually available — false means the plan is windless */
  forecastUsed: boolean;
  /** whether the two passes agreed to within `toleranceHours` */
  stable: boolean;
} {
  const tolerance = input.toleranceHours ?? 0.5;

  // pass 1 — still air, purely to learn the arrival times
  const stillAir = input.solve(0);
  const hour1 = input.hourAt(stillAir);
  const wind = input.windAt(hour1);
  const headwind = headwindKph({ wind, travelDeg: input.travelDeg });

  if (!wind) {
    // No forecast. Hand back the plan the rider already had, and say so — returning a
    // windless plan without `forecastUsed: false` would hide the only reason the
    // correction could not run.
    return { plan: stillAir, headwindKph: 0, driftHours: 0, forecastUsed: false, stable: true };
  }

  // pass 2 — the headwind the rider actually meets on arrival
  const windy = input.solve(headwind);
  const drift = Math.abs(input.hourAt(windy) - hour1);

  return {
    plan: windy,
    headwindKph: headwind,
    driftHours: drift,
    forecastUsed: true,
    stable: drift < tolerance
  };
}
