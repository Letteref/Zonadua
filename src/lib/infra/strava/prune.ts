/**
 * 7-day API stream cache pruner (ARCHITECTURE.md §6.2, Strava API policy).
 *
 * ## Why only API rows expire
 *
 * Strava's API terms require that data fetched through the API is not retained indefinitely.
 * Raw streams are the bulk of it — a few hundred KB per ride — so they carry a seven-day
 * clock while the *summary* row (the ride in the list, its load numbers) stays: deleting the
 * activity would erase the rider's history, which the policy does not ask for and which would
 * make the app look like it lost data.
 *
 * A file the rider imported themselves is theirs and is never pruned, which is why the check
 * keys on `source === 'strava'` rather than on age alone. The `source` column exists on
 * `activity_streams` precisely to make that distinction a property of the row instead of a
 * guess about how it got there.
 *
 * The predicate is separate from the delete so the boundary can be tested without IndexedDB
 * (the unit environment has none), and the DB call below stays a thin, obvious wrapper.
 */

import { db, type ActivitySource } from '../../data/db';

/** How long an API-sourced raw stream may be kept. */
export const STRAVA_STREAM_TTL_DAYS = 7;

const DAY_MS = 86_400_000;

export interface StreamAgeRow {
  id: string;
  source: ActivitySource;
  updatedAt: number;
}

/**
 * Whether one stream row is past its cache life.
 *
 * The comparison is strict (`>`): a row written exactly seven days ago is still inside the
 * window. `updatedAt` is the refresh time, so a stream re-pulled by a later sync resets its
 * own clock rather than expiring on the age of the ride.
 */
export function isExpiredApiStream(
  row: Pick<StreamAgeRow, 'source' | 'updatedAt'>,
  now: number,
  ttlDays = STRAVA_STREAM_TTL_DAYS
): boolean {
  if (row.source !== 'strava') return false;
  if (!Number.isFinite(row.updatedAt)) return true; // a corrupt clock must not pin data forever
  return now - row.updatedAt > ttlDays * DAY_MS;
}

/** Ids of every row the pruner would delete. Pure, so the selection can be asserted directly. */
export function expiredApiStreamIds(
  rows: readonly StreamAgeRow[],
  now: number,
  ttlDays = STRAVA_STREAM_TTL_DAYS
): string[] {
  return rows.filter((r) => isExpiredApiStream(r, now, ttlDays)).map((r) => r.id);
}

/**
 * Delete every expired API-sourced stream. Returns how many rows were removed, so a sync
 * can report what it did instead of silently shrinking the database.
 */
export async function pruneExpiredApiStreams(
  now = Date.now(),
  ttlDays = STRAVA_STREAM_TTL_DAYS
): Promise<number> {
  const rows = (await db.activity_streams.toArray()) as StreamAgeRow[];
  const ids = expiredApiStreamIds(rows, now, ttlDays);
  if (ids.length > 0) await db.activity_streams.bulkDelete(ids);
  return ids.length;
}
