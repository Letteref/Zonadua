/**
 * Weather-aware departure picker — "when should I roll out on this route".
 *
 * ## What it answers
 *
 * Given a saved route, the rider's own historical speed, and an hourly Open-Meteo
 * forecast, this scores every departure hour in the near horizon and hands back the
 * options with the one that gets them home driest, coolest and least wind-resisted.
 *
 * ## The honest-figures doctrine (same as coach-insight)
 *
 * Two figures are *measured or derived* and both are restated in `evidence`: the
 * rider's historical moving speed (from their own logged rides) and the route distance.
 * Everything else on an option — temperature, rain probability, headwind — is forecast,
 * labelled as such by its source in the evidence line. Durations are derived from the
 * measured speed and the forecast wind; nothing here guesses a speed for the rider.
 *
 * An absent input refuses rather than fakes: no historical speed → `null` (a departure
 * picker that invents an ETA is worse than no picker), no bearing → wind is not applied
 * and the option says so, a ride window that runs past the end of the forecast → the
 * candidate is dropped rather than scored on the hours that happen to be visible.
 *
 * ## The ETA model, stated once
 *
 * Two passes, the same doctrine as `correctForWind`: pass one rides still air to learn
 * how many forecast hours the ride covers, pass two re-solves against the mean headwind
 * of *those* hours. Two passes because the shift is minutes, not hours; convergence
 * would pretend to a precision an hourly forecast cannot deliver. Speed is reduced
 * one-for-one by the mean headwind (a 10 km/h head on a 30 km/h rider is a 20 km/h
 * rider), floored at a crawl so a 40 km/h gale cannot produce a negative duration.
 *
 * Pure: no Dexie, no fetch, no clock. `nowEpochMin` is passed in.
 */

import { headwindKph, type WindSample } from './wind';

/** One forecast hour, already parsed and validated by infra. */
export interface RideForecastHour {
  /** local wall-clock hour start at the route, 'YYYY-MM-DDTHH:mm' (timezone=auto) */
  time: string;
  tempC: number;
  /** 0–100 */
  precipProbPct: number;
  /** rainfall over the hour, mm */
  precipMm: number;
  wind: WindSample;
}

export interface HistoricalSpeed {
  /** distance-weighted moving speed over the sampled rides, km/h, 0.1 precision */
  kph: number;
  /** how many rides the figure rests on */
  rides: number;
}

/**
 * The rider's own speed, from their own log.
 *
 * Distance-weighted (Σdistance ÷ Σmoving time), not an average of per-ride averages:
 * a 120 km ride at 30 km/h and a 20 km spin at 20 km/h average 25 km/h by the mean of
 * averages but 28.6 km/h by reality, and reality is what the ETA must use.
 *
 * Short spins and commutes are excluded by default — they are errand speeds, not ride
 * speeds, and a route planned around them would be planned around the traffic lights.
 * `null` when nothing qualifies, so the caller can ask for a first ride instead of
 * showing a fabricated ETA.
 */
export function historicalSpeedKph(
  samples: readonly { distanceKm: number; movingSec: number }[],
  opts: { maxRides?: number; minDistanceKm?: number; minMovingSec?: number } = {}
): HistoricalSpeed | null {
  const maxRides = opts.maxRides ?? 12;
  const minKm = opts.minDistanceKm ?? 3;
  const minSec = opts.minMovingSec ?? 900; // 15 min — below this it is an errand

  const usable = samples.filter(
    (s) =>
      Number.isFinite(s.distanceKm) &&
      Number.isFinite(s.movingSec) &&
      s.distanceKm >= minKm &&
      s.movingSec >= minSec
  );
  if (usable.length === 0) return null;

  // the caller passes newest-first (the app's activity order); keep the most recent slice
  const slice = usable.slice(0, maxRides);
  const km = slice.reduce((s, r) => s + r.distanceKm, 0);
  const hours = slice.reduce((s, r) => s + r.movingSec, 0) / 3600;
  if (!(km > 0) || !(hours > 0)) return null;
  return { kph: Math.round((km / hours) * 10) / 10, rides: slice.length };
}

export interface DepartureInput {
  forecast: readonly RideForecastHour[];
  /** Open-Meteo `utc_offset_seconds` for the route's timezone */
  utcOffsetSeconds: number;
  /** minutes since the Unix epoch, in the rider's decision moment */
  nowEpochMin: number;
  distanceKm: number;
  /** the rider's own speed from `historicalSpeedKph`; `null` refuses the whole plan */
  speed: HistoricalSpeed | null;
  /** route bearing; `null` means wind is not applied, and the option says so */
  bearingDeg: number | null;
  /** how far ahead departures are offered, hours (default 24) */
  horizonHours?: number;
  /** minimum lead time before a candidate can leave, minutes (default 30) */
  minLeadMin?: number;
}

export interface DepartureOption {
  hourIndex: number;
  /**
   * The roll-out as a true instant (epoch minutes) — `startClock` with its date
   * attached. A forecast hour can sit on tomorrow, and a plan that stores only the
   * wall-clock would silently move a 06:00 roll-out onto today; this is the number
   * a race plan should keep.
   */
  startEpochMin: number;
  /** wall-clock departure, 'HH:MM' at the route */
  startClock: string;
  /** true wall-clock finish; may sit on the next day */
  finishClock: string;
  /** whether the ride crosses local midnight */
  finishesNextDay: boolean;
  /** wind-adjusted duration, hours, 0.1 precision */
  durationH: number;
  /** mean temperature over the ride window, °C */
  tempC: number;
  /** worst rain probability met on the ride, % */
  rainPct: number;
  /** rain that actually falls during the ride, mm */
  precipMm: number;
  /** mean headwind over the ride window, km/h, positive = into the rider's face */
  headwindKph: number;
  /** lower is better; a heuristic, documented at `scoreDeparture` */
  score: number;
}

export interface DeparturePlan {
  /** hourly candidates, soonest first; may be empty when the horizon is unusable */
  options: DepartureOption[];
  /** index into `options` of the best score; `null` when there are no options */
  bestIndex: number | null;
  /** the measured figures this plan rests on, for the card's evidence line */
  evidence: string;
}

/**
 * Penalties (score points per unit). A heuristic, stated as one:
 * - rain probability is the dominant discomfort: a wet rider is a cold rider.
 * - actual rainfall is charged per mm — forecast drizzle over a 4 h ride soaks.
 * - heat above 30 °C and cold below 10 °C both cost rideability, in opposite directions.
 * - a headwind is charged against a rider because it lengthens the ride they must do;
 *   a tailwind is *not* refunded, because the plan cannot promise one.
 */
const W_RAIN_PCT = 0.6;
const W_PRECIP_MM = 4;
const W_HEAT_PER_C = 3; // above HOT_C
const W_COLD_PER_C = 2; // below COLD_C
const W_HEADWIND = 1.2;
const HOT_C = 30;
const COLD_C = 10;

/** Below this the ETA model stops being a ride and starts being a guess. */
const MIN_SPEED_KPH = 5;

/** 'YYYY-MM-DDTHH:mm' at the route → minutes since the Unix epoch. */
export function epochMinutesOfRouteLocal(time: string, utcOffsetSeconds: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const utcMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Math.round(utcMs / 60000) - utcOffsetSeconds / 60;
}

/**
 * Epoch minutes → wall-clock **at the route**, via UTC fields (locale-free, testable).
 *
 * The offset is added back on purpose: the instant is UTC-based, but a pill labelled
 * "06:00" must mean 06:00 on the hill. Formatting the raw instant showed the *UTC*
 * hour instead — every pill read seven hours early against a Jakarta forecast, and a
 * rider tapping "14:00" would have rolled out at 21:00. The calendar day is taken
 * after the shift too, so "finishes next day" follows the route's midnight, not UTC's.
 */
function clockOf(epochMin: number, offsetMin: number): { clock: string; dayNumber: number } {
  const d = new Date((epochMin + offsetMin) * 60000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    clock: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    dayNumber: Math.floor((epochMin + offsetMin) / 1440)
  };
}

/** Score a candidate — exported so the weights can be asserted directly. */
export function scoreDeparture(o: Omit<DepartureOption, 'score'>): number {
  const score =
    o.rainPct * W_RAIN_PCT +
    o.precipMm * W_PRECIP_MM +
    Math.max(0, o.tempC - HOT_C) * W_HEAT_PER_C +
    Math.max(0, COLD_C - o.tempC) * W_COLD_PER_C +
    Math.max(0, o.headwindKph) * W_HEADWIND;
  return Math.round(score * 10) / 10;
}

/**
 * The whole picker: every usable departure hour, scored, with the best one marked.
 *
 * `null` when there is no honest plan to make — an empty forecast, a non-positive
 * distance, or no historical speed. The caller reports which, in words.
 */
export function buildDeparturePlan(i: DepartureInput): DeparturePlan | null {
  const speed = i.speed?.kph ?? null;
  if (speed == null || !Number.isFinite(speed) || speed <= 0) return null;
  if (!(i.distanceKm > 0) || i.forecast.length === 0) return null;

  const stillAirH = i.distanceKm / speed;
  if (!Number.isFinite(stillAirH) || stillAirH <= 0) return null;

  const horizon = Math.min(i.horizonHours ?? 24, i.forecast.length);
  const lead = i.minLeadMin ?? 30;

  // first forecast hour whose wall-clock instant is at least `lead` minutes away
  let first = -1;
  for (let h = 0; h < i.forecast.length; h++) {
    const e = epochMinutesOfRouteLocal(i.forecast[h].time, i.utcOffsetSeconds);
    if (e == null) continue;
    if (e >= i.nowEpochMin + lead) {
      first = h;
      break;
    }
  }
  if (first < 0) return null;

  const options: DepartureOption[] = [];
  const lastIndex = Math.min(i.forecast.length - 1, first + horizon - 1);

  for (let h = first; h <= lastIndex; h++) {
    const startEpoch = epochMinutesOfRouteLocal(i.forecast[h].time, i.utcOffsetSeconds);
    if (startEpoch == null) continue;

    // pass 1 — still air, to learn how many forecast hours the ride covers
    const windowLen = Math.ceil(stillAirH);
    // a window that runs past the forecast is not scored: the hours that matter would
    // be the ones nobody can see
    if (h + windowLen > i.forecast.length) continue;

    let headSum = 0;
    let tempSum = 0;
    let rainMax = 0;
    let precipSum = 0;
    let windSeen = false;
    for (let k = h; k < h + windowLen; k++) {
      const hour = i.forecast[k];
      tempSum += hour.tempC;
      rainMax = Math.max(rainMax, hour.precipProbPct);
      precipSum += hour.precipMm;
      if (i.bearingDeg != null) {
        headSum += headwindKph({ wind: hour.wind, travelDeg: i.bearingDeg });
        windSeen = true;
      }
    }
    const meanHead = windSeen ? headSum / windowLen : 0;

    // pass 2 — re-solve against the wind the rider actually meets
    const effSpeed = Math.max(MIN_SPEED_KPH, speed - meanHead);
    const durationH = Math.round((i.distanceKm / effSpeed) * 10) / 10;

    const finishEpoch = startEpoch + Math.round(durationH * 60);
    const offsetMin = i.utcOffsetSeconds / 60;
    const start = clockOf(startEpoch, offsetMin);
    const finish = clockOf(finishEpoch, offsetMin);

    const base: Omit<DepartureOption, 'score'> = {
      hourIndex: h,
      startEpochMin: startEpoch,
      startClock: start.clock,
      finishClock: finish.clock,
      finishesNextDay: finish.dayNumber !== start.dayNumber,
      durationH,
      tempC: Math.round((tempSum / windowLen) * 10) / 10,
      rainPct: rainMax,
      precipMm: Math.round(precipSum * 10) / 10,
      headwindKph: Math.round(meanHead * 10) / 10
    };
    options.push({ ...base, score: scoreDeparture(base) });
  }

  if (options.length === 0) return null;

  let bestIndex = 0;
  for (let n = 1; n < options.length; n++) {
    if (options[n].score < options[bestIndex].score) bestIndex = n;
  }

  // the measured figures, restated for the evidence line
  const measured = [
    `ETA from your last ${i.speed!.rides} ride${i.speed!.rides === 1 ? '' : 's'}`,
    `${speed.toFixed(1)} km/h historical`,
    `${i.distanceKm.toFixed(1)} km route`,
    'Open-Meteo hourly'
  ];
  if (i.bearingDeg == null) measured.push('wind not applied (no track bearing)');

  return {
    options,
    bestIndex,
    evidence: measured.join(' · ')
  };
}
