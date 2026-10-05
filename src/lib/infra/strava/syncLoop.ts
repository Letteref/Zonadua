/**
 * Strava sync loop — pull activities + streams into Dexie (ARCHITECTURE.md §6.2).
 *
 * ## The shape of a session
 *
 * One call to `runStravaSync` fetches `/athlete/activities` with the stored epoch-seconds
 * cursor (`STRAVA_PER_PAGE = 100` already covers the 50-activity session cap, so one
 * request per session is the whole paging story), maps each summary through `mapSummary`
 * (provenance `strava`, no invented zeros), stores the row, then fetches streams for
 * activities that do not already hold a fresh one. After every response the rate-limit
 * guard decides whether the session may continue: at 80% of either window the sync
 * **stops and reports**, it never presses into a 429.
 *
 * ## Honesty rules the loop keeps
 *
 * - `lastSyncAt` is written **only after work actually completed**. A failed sync leaves
 *   the old timestamp standing so the Settings chip keeps saying "Needs sync" instead of
 *   claiming freshness it does not have.
 * - Streams are fetched for activities whose stored stream is older than the summary's
 *   `start_date` (or missing): a re-sync never re-downloads what it already has.
 * - Strava's stream `time` is seconds; the app's sample convention is milliseconds (the
 *   GPX importer's too — `extractPower` derives the sampling rate from ms deltas). The
 *   loop converts after decode, so `decodeStreams` stays the pure mapper its tests pin.
 * - After the pull, `pruneExpiredApiStreams()` deletes API-sourced streams older than the
 *   7-day cache window — the summary rows and the rider's own imports are never touched.
 *
 * The Dexie handle is module state (the one seam the unit environment cannot fake), but
 * fetch, clock, cursor persistence, refresh and the stream fetcher are injected, so every
 * HTTP branch is testable with fake servers.
 */

import { db } from '../../data/db';
import { encodeStream } from '../../data/streams';
import { pruneExpiredApiStreams } from './prune';
import { parseRateLimit, retryDelayMs, shouldThrottle, type RateLimit } from './ratelimit';
import { activitiesListUrl, decodeStreams, mapSummary, streamsUrl, type StravaSummary } from './sync';

export interface SyncDeps {
  /** Bearer token getter — returns undefined when nothing usable is stored. */
  token: () => string | undefined;
  /** Epoch-seconds cursor of the last sync (0 = full history). */
  cursor: () => number;
  /** Persist the cursor + lastSyncAt after a session that did work. */
  save: (patch: { cursor?: number; lastSyncAt: number }) => Promise<void>;
  /** Exchange a refresh token for a fresh access token through the Pages Function. */
  refresh: (refreshToken: string) => Promise<{ accessToken: string; expiresAt: number } | null>;
  fetchFn: typeof fetch;
  now: () => number;
  /** Stream fetcher — injectable so tests can serve per-activity payloads. */
  fetchStreams?: (activityId: string, token: string) => Promise<StreamFetch>;
}

/** What one stream call came back with. */
export type StreamFetch =
  | { kind: 'ok'; body: unknown }
  | { kind: 'failed' }
  | { kind: 'rate_limited' };

export type SyncFailureReason =
  | 'not_connected'
  | 'token_unrefreshable'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'network_error';

export interface SyncResult {
  ok: boolean;
  /** summaries mapped and stored this session */
  pulled: number;
  /** stream rows written this session */
  streamsFetched: number;
  /** API streams deleted by the 7-day pruner after the pull */
  pruned: number;
  /** when the loop stopped early, why */
  reason?: SyncFailureReason;
  /** ms until the rate-limit window resets (only for `rate_limited`) */
  retryInMs?: number;
  /** the guard's final reading, for the UI to show the budget honestly */
  rateLimit?: RateLimit | null;
  /** 401 even after a refresh attempt */
  authError?: string;
}

/** Result of one page fetch: status, parsed summaries, and the guard's reading. */
interface PageFetch {
  status: number;
  summaries: StravaSummary[];
  rateLimit: RateLimit | null;
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/**
 * Fetch one page of summaries.
 *
 * Returns the status even on failure so the loop can branch on 401/403/429; `summaries`
 * stays empty on any non-200. The rate-limit headers are read on *every* response —
 * including failures, which Strava also meters.
 */
async function fetchPage(deps: SyncDeps, url: string, token: string): Promise<PageFetch> {
  const res = await deps.fetchFn(url, { headers: authHeaders(token) });
  // the loop owns the clock: the guard's reading is relative to the session, not the wall
  const rl = parseRateLimit((n) => res.headers.get(n), deps.now());
  if (!res.ok) return { status: res.status, summaries: [], rateLimit: rl };
  const body: unknown = await res.json().catch(() => null);
  return { status: res.status, summaries: Array.isArray(body) ? (body as StravaSummary[]) : [], rateLimit: rl };
}

/**
 * Run one sync session. Never throws: every failure is a reported reason, because a sync
 * that fails is a status the rider should read, not an exception the console should eat.
 */
export async function runStravaSync(deps: SyncDeps): Promise<SyncResult> {
  const result: SyncResult = { ok: false, pulled: 0, streamsFetched: 0, pruned: 0 };

  const token = deps.token();
  if (!token) return { ...result, reason: 'not_connected' };

  const fetchStreams = deps.fetchStreams ?? defaultFetchStreams(deps);
  const after = deps.cursor();
  let bearer = token;
  let summaries: StravaSummary[] = [];
  let rateLimit: RateLimit | null = null;

  const page = await fetchPage(deps, activitiesListUrl(after), bearer);
  rateLimit = page.rateLimit;

  if (page.status === 401) {
    // The stored token was rejected. Try exactly one refresh, then the page once more.
    const refreshed = await tryRefresh(deps);
    if (!refreshed.ok) return { ...result, rateLimit, reason: refreshed.reason, authError: refreshed.detail };
    bearer = refreshed.token;

    const retry = await fetchPage(deps, activitiesListUrl(after), bearer);
    rateLimit = retry.rateLimit ?? rateLimit;
    if (retry.status === 401) {
      return { ...result, rateLimit, reason: 'unauthorized', authError: 'still unauthorized after refresh' };
    }
    if (retry.status !== 200) {
      return { ...result, rateLimit, reason: statusReason(retry.status) };
    }
    summaries = retry.summaries;
  } else if (page.status === 200) {
    summaries = page.summaries;
  } else {
    if (page.status === 429) {
      const delay = rateLimit ? retryDelayMs(rateLimit, deps.now()) : 15 * 60_000;
      return { ...result, rateLimit, reason: 'rate_limited', retryInMs: delay };
    }
    return { ...result, rateLimit, reason: statusReason(page.status) };
  }

  // ---- guard before any write: stop before burning the budget we just read ----
  if (rateLimit && shouldThrottle(rateLimit)) {
    return { ...result, rateLimit, reason: 'rate_limited', retryInMs: retryDelayMs(rateLimit, deps.now()) };
  }

  // ---- map + store summaries ----
  const stored: Array<{ id: string; date: string }> = [];
  for (const raw of summaries) {
    const act = mapSummary(raw, deps.now());
    if (!act) continue;
    stored.push({ id: act.id, date: act.date });
    await db.activities.put(act);
    result.pulled++;
  }

  // ---- streams: only for activities whose stored stream is stale or missing ----
  for (const { id, date } of stored) {
    const existing = await db.activity_streams.get(id);
    if (existing && existing.updatedAt > Date.parse(date)) continue;

    let fetched: StreamFetch;
    try {
      fetched = await fetchStreams(id, bearer);
    } catch {
      fetched = { kind: 'failed' };
    }

    // The guard applies to stream calls too: stop rather than push through.
    if (fetched.kind === 'rate_limited') {
      return {
        ...result,
        rateLimit,
        reason: 'rate_limited',
        retryInMs: rateLimit ? retryDelayMs(rateLimit, deps.now()) : undefined
      };
    }
    if (fetched.kind !== 'ok') continue;

    const samples = decodeStreams(fetched.body);
    if (!samples) continue;
    // Strava's `time` series is seconds; the stored convention is milliseconds so every
    // reader (importer files, synthetic traces, this) shares one unit — see extractPower.
    for (const s of samples) if (typeof s.t === 'number') s.t = s.t * 1000;
    await db.activity_streams.put(await encodeStream(id, samples, 'strava'));
    result.streamsFetched++;
  }

  // ---- cursor + lastSyncAt: only after work actually completed ----
  const maxStart = stored.reduce((m, s) => Math.max(m, Date.parse(s.date) / 1000), after);
  const lastSyncAt = deps.now();
  if (maxStart > after) {
    await deps.save({ cursor: maxStart, lastSyncAt });
  } else {
    // nothing new upstream — still stamp the sync so "Synced x ago" is truthful
    await deps.save({ cursor: after, lastSyncAt });
  }

  // ---- 7-day API cache policy ----
  result.pruned = await pruneExpiredApiStreams(deps.now());
  result.rateLimit = rateLimit ?? undefined;
  result.ok = true;
  return result;
}

function statusReason(status: number): SyncFailureReason {
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  return 'network_error';
}

/**
 * One refresh attempt through the Pages Function.
 *
 * Strava omits `refresh_token` on a refresh response, so the row keeps the stored one —
 * this only returns the new access token and its new expiry.
 */
async function tryRefresh(
  deps: SyncDeps
): Promise<{ ok: true; token: string } | { ok: false; reason: SyncFailureReason; detail?: string }> {
  const stored = await db.sync_state.get('strava');
  const rt = stored?.refreshToken;
  if (!rt) return { ok: false, reason: 'token_unrefreshable' };

  const out = await deps.refresh(rt);
  if (!out) return { ok: false, reason: 'token_unrefreshable' };

  await db.sync_state.put({
    ...(stored ?? { id: 'strava' as const }),
    accessToken: out.accessToken,
    // keep the stored refresh token: Strava does not send a new one on refresh
    refreshToken: stored?.refreshToken ?? rt,
    expiresAt: out.expiresAt,
    updatedAt: deps.now()
  });
  return { ok: true, token: out.accessToken };
}

/** Default stream fetcher: Strava's streams endpoint with the session bearer. */
function defaultFetchStreams(deps: SyncDeps): (activityId: string, token: string) => Promise<StreamFetch> {
  return async (activityId, token) => {
    try {
      const res = await deps.fetchFn(streamsUrl(activityId), { headers: authHeaders(token) });
      if (res.status === 429) return { kind: 'rate_limited' };
      if (!res.ok) return { kind: 'failed' };
      return { kind: 'ok', body: await res.json() };
    } catch {
      return { kind: 'failed' };
    }
  };
}
