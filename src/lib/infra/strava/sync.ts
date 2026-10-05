/**
 * Strava activity + stream mapping (ARCHITECTURE.md §6.2).
 *
 * ## The shape of a sync
 *
 * `GET /activities?per_page=100&after=<cursor>` returns summaries; streams are a second
 * call per activity (`GET /activities/{id}/streams`). The architecture caps a sync session
 * at **50 activities** with a manual resume, so a rider can stop and continue instead of
 * burning a whole daily quota in one go. `SYNC_BATCH_DEFAULT` is that cap.
 *
 * ## Honesty in the mapping
 *
 * Strava's `weighted_average_watts` is a **normalized power**-style figure, so it maps to
 * `np`; the app then computes `if`/`tss` from it through the same `domain/metrics` path as
 * an imported file, and `mVersion` records which version did. `mapSummary` never invents a
 * field Strava did not send: a ride with no power meter arrives with `avgPower` absent, not
 * with a zero, because zero watts is a measurement and "not measured" is not.
 *
 * ## API host
 *
 * The browser calls Strava directly (token in memory, ARCHITECTURE.md §46), so the base URL
 * lives here: `https://www.strava.com/api/v3`, Strava's documented read endpoint.
 */

import type { Activity } from '../../data/db';
import type { StreamSample } from '../../data/streams';

export const STRAVA_API = 'https://www.strava.com/api/v3';

/** Activities per sync session, with a manual resume (ARCHITECTURE.md §6.2). */
export const SYNC_BATCH_DEFAULT = 50;

/** Strava's maximum page size for the activity list. */
export const STRAVA_PER_PAGE = 100;

/**
 * Summary page URL. `after` is an epoch **seconds** cursor — the newest `start_date` of the
 * previous sync — which is what makes a resumed sync pull only what it has not seen.
 */
export function activitiesListUrl(afterSec: number, page = 1): string {
  const q = new URLSearchParams({
    per_page: String(STRAVA_PER_PAGE),
    page: String(page),
    after: String(Math.max(0, Math.floor(afterSec)))
  });
  return `${STRAVA_API}/athlete/activities?${q.toString()}`;
}

/**
 * Streams URL.
 *
 * Only the keys the app stores are asked for. `velocity_smooth` and `temp` are deliberately
 * omitted: neither is used by a single domain calculation, and every extra key is bytes the
 * rider's browser must fetch and the 7-day pruner must later delete.
 */
export function streamsUrl(activityId: string | number): string {
  const keys = 'time,latlng,altitude,watts,heartrate,cadence';
  const q = new URLSearchParams({ keys, key_by_type: 'true' });
  return `${STRAVA_API}/activities/${encodeURIComponent(String(activityId))}/streams?${q.toString()}`;
}

export interface StravaSummary {
  id?: unknown;
  name?: unknown;
  start_date?: unknown;
  distance?: unknown;
  moving_time?: unknown;
  elapsed_time?: unknown;
  total_elevation_gain?: unknown;
  average_watts?: unknown;
  weighted_average_watts?: unknown;
  average_heartrate?: unknown;
  max_heartrate?: unknown;
  kilojoules?: unknown;
  commute?: unknown;
  type?: unknown;
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Map one Strava summary onto an `Activity` row.
 *
 * Returns `null` when the summary is missing an `id` or a parseable `start_date`: without
 * those the row has no primary key and no place on the timeline, and writing it would
 * create a ride that is unreachable and unreadable. Everything else is optional, and its
 * absence stays absent.
 *
 * `synthetic` is pinned to `false` here. The seeder is the only writer allowed to set it
 * true, and this mapper is the one place real Strava data enters the database.
 */
export function mapSummary(summary: StravaSummary, now = Date.now()): Activity | null {
  if (!summary || typeof summary !== 'object') return null;
  const id = summary.id;
  if (typeof id !== 'number' && typeof id !== 'string') return null;

  const start = summary.start_date;
  if (typeof start !== 'string' || Number.isNaN(Date.parse(start))) return null;

  const name = typeof summary.name === 'string' && summary.name.trim() ? summary.name.trim() : 'Strava activity';

  return {
    id: String(id),
    // Strava sends UTC ISO; keep it as-is so every existing date formatter reads it the
    // same way it reads an imported file.
    date: new Date(start).toISOString(),
    name,
    source: 'strava',
    distanceKm: (num(summary.distance) ?? 0) / 1000,
    movingSec: num(summary.moving_time) ?? 0,
    elapsedSec: num(summary.elapsed_time) ?? 0,
    elevGainM: num(summary.total_elevation_gain) ?? 0,
    avgPower: num(summary.average_watts),
    np: num(summary.weighted_average_watts),
    avgHr: num(summary.average_heartrate),
    maxHr: num(summary.max_heartrate),
    // Strava reports work done in kilojoules; the app's field is kcal. They are close
    // enough for a load estimate and are the figure Strava itself displays.
    kcal: num(summary.kilojoules) ?? 0,
    commute: summary.commute === true ? true : undefined,
    synthetic: false,
    updatedAt: now
  };
}

/** A Strava stream series, as returned by the streams endpoint. */
export interface StravaStream {
  type?: unknown;
  data?: unknown;
}

/**
 * Which Strava stream feeds which stored field.
 *
 * `latlng` is handled separately: Strava sends it as `[lat, lng]` tuples where every other
 * series is a flat number array.
 */
const STREAM_FIELD: Record<string, keyof StreamSample> = {
  time: 't',
  altitude: 'alt',
  watts: 'watts',
  heartrate: 'hr',
  cadence: 'cad'
};

/**
 * Decode Strava's streams payload into the app's sample rows.
 *
 * Returns `null` on any malformed input — a non-array body, an unknown series shape, or
 * two series of different lengths. The length check is the important one: ragged arrays
 * would pair a rider's wattage from one minute with a heart rate from another, and the
 * result would look like a perfectly good ride. Callers treat `null` as "no usable streams"
 * and leave the row without a trace rather than storing a misaligned one.
 */
export function decodeStreams(body: unknown): StreamSample[] | null {
  if (!Array.isArray(body) || body.length === 0) return null;

  const byType = new Map<string, unknown[]>();
  for (const raw of body) {
    if (!raw || typeof raw !== 'object') return null;
    const { type, data } = raw as StravaStream;
    if (typeof type !== 'string' || !Array.isArray(data) || data.length === 0) return null;
    byType.set(type, data);
  }

  const latlng = byType.get('latlng');
  let sampleCount = -1;
  for (const [, data] of byType) {
    if (sampleCount === -1) sampleCount = data.length;
    else if (data.length !== sampleCount) return null;
  }
  if (sampleCount <= 0) return null;

  const out: StreamSample[] = Array.from({ length: sampleCount }, () => ({}));

  for (const [type, data] of byType) {
    if (type === 'latlng') continue;
    const field = STREAM_FIELD[type];
    if (!field) continue; // an extra key Strava volunteers: ignored, not an error
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (typeof v === 'number' && Number.isFinite(v)) out[i][field] = v;
    }
  }

  if (latlng) {
    for (let i = 0; i < latlng.length; i++) {
      const pair = latlng[i];
      if (!Array.isArray(pair) || pair.length < 2) return null;
      const [lat, lng] = pair;
      if (typeof lat !== 'number' || typeof lng !== 'number') return null;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      out[i].lat = lat;
      out[i].lng = lng;
    }
  }

  return out;
}
