/**
 * Open-Meteo hourly wind forecast.
 *
 * ## Why no API key
 *
 * Open-Meteo serves current and forecast data without a key, which keeps the promise
 * that Zonadua works offline and for free: weather is an *enhancement* on top of the
 * plan, not a subscription. If this ever needs a key it must degrade to "no forecast",
 * never to a stored value that silently ages.
 *
 * ## The failure posture
 *
 * Every failure path here returns `null`. A forecast that did not load is not an error
 * the rider needs to solve — the plan they already have is still correct, just windless.
 * The one thing this module must never do is return a *partial* forecast as if it were
 * complete, because a hole punched mid-day would look like "calm" and quietly understate
 * a headwind. So a response that does not carry one wind speed and direction per hour is
 * rejected outright.
 *
 * Kept separate from `domain/wind.ts` so the geometry can be tested exhaustively without
 * a network, and so this can be tested from fixtures without a browser.
 */

import type { WindSample } from '../../domain/wind';
import type { RideForecastHour } from '../../domain/departure';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

export interface ForecastRequest {
  latitude: number;
  longitude: number;
  /** ISO date, YYYY-MM-DD */
  startDate: string;
  /** ISO date, YYYY-MM-DD */
  endDate: string;
}

/** URL for a request, exported so the shape can be asserted without a network. */
export function forecastUrl(req: ForecastRequest): string {
  const q = new URLSearchParams({
    latitude: String(req.latitude),
    longitude: String(req.longitude),
    hourly: 'wind_speed_10m,wind_direction_10m',
    wind_speed_unit: 'kmh',
    timezone: 'UTC',
    start_date: req.startDate,
    end_date: req.endDate
  });
  return `${ENDPOINT}?${q.toString()}`;
}

/**
 * Pull hourly wind out of an Open-Meteo response body.
 *
 * Returns `null` for anything that is not a complete, well-formed hourly series. The
 * caller cannot distinguish "no wind" from "no forecast" from the result alone, so it
 * gets `null` for both and reports the difference in words rather than in a zero bar.
 */
export function parseHourlyWind(body: unknown): WindSample[] | null {
  if (!body || typeof body !== 'object') return null;
  const hourly = (body as { hourly?: unknown }).hourly;
  if (!hourly || typeof hourly !== 'object') return null;

  const speeds = (hourly as { wind_speed_10m?: unknown }).wind_speed_10m;
  const dirs = (hourly as { wind_direction_10m?: unknown }).wind_direction_10m;
  if (!Array.isArray(speeds) || !Array.isArray(dirs)) return null;
  // a ragged array means a missing hour somewhere; refuse rather than under-report
  if (speeds.length !== dirs.length || speeds.length === 0) return null;

  const out: WindSample[] = [];
  for (let i = 0; i < speeds.length; i++) {
    // `Number(null)` is 0 and `Number('')` is 0, so a missing hour would otherwise arrive
    // as a *calm* reading — understating the headwind around it, which is the exact
    // failure this parser refuses to commit. Open-Meteo signals "no data" with null.
    const rawS = speeds[i];
    const rawD = dirs[i];
    if (rawS == null || rawD == null) return null;
    const s = Number(rawS);
    const d = Number(rawD);
    if (!Number.isFinite(s) || !Number.isFinite(d)) return null;
    out.push({ speedKph: s, fromDeg: ((d % 360) + 360) % 360 });
  }
  return out;
}

/**
 * Fetch a forecast. Returns `null` on any failure — network, HTTP status, unparseable
 * body, or a partial series — and never throws, because weather is an optional layer on
 * top of a plan that already works without it.
 */
export async function fetchWindForecast(
  req: ForecastRequest,
  signal?: AbortSignal
): Promise<WindSample[] | null> {
  try {
    const res = await fetch(forecastUrl(req), { signal });
    if (!res.ok) return null;
    return parseHourlyWind(await res.json());
  } catch {
    // offline, DNS failure, abort, malformed JSON — all the same to the caller
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Ride forecast — the departure picker's richer series.
 *
 * Separate from `fetchWindForecast` on purpose: that one answers the estimator's wind
 * card and its contract is "wind or nothing", while this one carries temperature and
 * rain as well, in the *route's* timezone (`timezone=auto`), because a departure picker
 * that shows UTC hours to a rider planning their morning is showing the wrong clock.
 * Keeping the two calls apart also means the wind card's mocked E2E fixture cannot
 * silently become a ride forecast: a wind-only body fails this parser's completeness
 * check and degrades to "no forecast", which is the honest answer for that shape.
 * ------------------------------------------------------------------ */

export interface RideForecast {
  /** Open-Meteo's own UTC offset for the route's timezone, seconds */
  utcOffsetSeconds: number;
  hours: RideForecastHour[];
}

/** URL for a ride forecast, exported so the shape can be asserted without a network. */
export function rideForecastUrl(req: ForecastRequest): string {
  const q = new URLSearchParams({
    latitude: String(req.latitude),
    longitude: String(req.longitude),
    hourly:
      'temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m',
    wind_speed_unit: 'kmh',
    // route-local wall clock: the picker offers "06:00", and 06:00 means 06:00 *there*
    timezone: 'auto',
    start_date: req.startDate,
    end_date: req.endDate
  });
  return `${ENDPOINT}?${q.toString()}`;
}

/**
 * Pull a complete ride forecast out of an Open-Meteo body.
 *
 * The same completeness doctrine as `parseHourlyWind`: any missing hour (Open-Meteo's
 * "no data" is null), any mismatched array length, or a missing offset rejects the
 * whole series. A hole in the rain series that read as "dry" would recommend the very
 * hour the rider gets soaked in.
 */
export function parseRideForecast(body: unknown): RideForecast | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { hourly?: unknown; utc_offset_seconds?: unknown };
  const hourly = b.hourly;
  if (!hourly || typeof hourly !== 'object') return null;

  const offset = Number(b.utc_offset_seconds);
  if (!Number.isFinite(offset)) return null;

  const h = hourly as Record<string, unknown>;
  const times = h.time;
  const temps = h.temperature_2m;
  const probs = h.precipitation_probability;
  const mms = h.precipitation;
  const speeds = h.wind_speed_10m;
  const dirs = h.wind_direction_10m;
  if (![times, temps, probs, mms, speeds, dirs].every((a) => Array.isArray(a))) return null;

  const t = times as unknown[];
  const tp = temps as unknown[];
  const pr = probs as unknown[];
  const mm = mms as unknown[];
  const ws = speeds as unknown[];
  const wd = dirs as unknown[];
  const n = t.length;
  if (n === 0 || [tp, pr, mm, ws, wd].some((a) => a.length !== n)) return null;

  const out: RideForecastHour[] = [];
  for (let i = 0; i < n; i++) {
    const tempC = Number(tp[i]);
    const prob = Number(pr[i]);
    const rain = Number(mm[i]);
    const s = Number(ws[i]);
    const d = Number(wd[i]);
    if (
      t[i] == null ||
      tp[i] == null ||
      pr[i] == null ||
      mm[i] == null ||
      ws[i] == null ||
      wd[i] == null ||
      ![tempC, prob, rain, s, d].every(Number.isFinite)
    ) {
      return null;
    }
    out.push({
      time: String(t[i]),
      tempC,
      precipProbPct: prob,
      precipMm: rain,
      wind: { speedKph: s, fromDeg: ((d % 360) + 360) % 360 }
    });
  }
  return { utcOffsetSeconds: offset, hours: out };
}

/**
 * Fetch a ride forecast. Returns `null` on any failure — the caller then says "no
 * forecast" in words instead of offering departure hours it cannot score.
 */
export async function fetchRideForecast(
  req: ForecastRequest,
  signal?: AbortSignal
): Promise<RideForecast | null> {
  try {
    const res = await fetch(rideForecastUrl(req), { signal });
    if (!res.ok) return null;
    return parseRideForecast(await res.json());
  } catch {
    return null;
  }
}
