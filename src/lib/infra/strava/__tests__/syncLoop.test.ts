import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runStravaSync, type StreamFetch, type SyncDeps, type SyncResult } from '../syncLoop';

/**
 * What these guard: the loop that turns Strava's API into local rows. The branches that
 * matter are the dishonest ones it must never take — writing `lastSyncAt` after a failed
 * pull, re-downloading a stream it already has, pushing through the 80% guard, or storing
 * a misaligned stream. Dexie is the one seam the unit environment cannot fake, so the
 * tests mock the data modules and record every write.
 */

const store = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  return { rows, reset: () => rows.clear() };
});

vi.mock('../../../data/db', () => ({
  db: {
    activities: {
      // a tiny in-memory stand-in: the backfill pass reads the table back through
      // `where('source').equals('strava')`, so the mock has to behave like a store rather
      // than a recorder
      get: vi.fn(async (id: unknown) => store.rows.get(String(id))),
      put: vi.fn(async (row: Record<string, unknown>) => {
        store.rows.set(String(row.id), { ...(store.rows.get(String(row.id)) ?? {}), ...row });
      }),
      update: vi.fn(async (id: unknown, patch: Record<string, unknown>) => {
        store.rows.set(String(id), { ...(store.rows.get(String(id)) ?? { id }), ...patch });
      }),
      where: (_index: string) => ({
        equals: (value: unknown) => ({
          toArray: async () => [...store.rows.values()].filter((r) => r.source === value)
        })
      })
    },
    activity_streams: {
      get: vi.fn(async (_id: unknown) => undefined),
      put: vi.fn(async () => undefined)
    },
    sync_state: {
      get: vi.fn(async () => ({ id: 'strava', accessToken: 'old', refreshToken: 'rt', updatedAt: 1 })),
      put: vi.fn(async () => undefined)
    }
  }
}));

vi.mock('../../../data/streams', () => ({
  encodeStream: vi.fn(async (id: string) => ({ id, compressed: new Uint8Array(), fields: [], source: 'strava', updatedAt: 5 }))
}));

vi.mock('../prune', () => ({ pruneExpiredApiStreams: vi.fn(async () => 3) }));

vi.mock('../../../data/recompute', () => ({
  backfillMetrics: vi.fn(async () => ({ scanned: 0, recomputed: 2, curvesComputed: 1, tracesGenerated: 0, noPower: 0 }))
}));

import { db } from '../../../data/db';
import { backfillMetrics } from '../../../data/recompute';
import { encodeStream } from '../../../data/streams';
import { pruneExpiredApiStreams } from '../prune';

/** The mocked fns behind the fake `db`/`encodeStream`, for call assertions. */
const activitiesPut = db.activities.put as unknown as ReturnType<typeof vi.fn>;
const streamsGet = db.activity_streams.get as unknown as ReturnType<typeof vi.fn>;
const streamsPut = db.activity_streams.put as unknown as ReturnType<typeof vi.fn>;
const statePut = db.sync_state.put as unknown as ReturnType<typeof vi.fn>;
const encode = encodeStream as unknown as ReturnType<typeof vi.fn>;
const pruner = pruneExpiredApiStreams as unknown as ReturnType<typeof vi.fn>;
const recompute = backfillMetrics as unknown as ReturnType<typeof vi.fn>;

const NOW = 1_800_000_000_000;

/** Strava summary shaped like the real payload (power meter + HR). */
function summary(id: number, startIso: string): Record<string, unknown> {
  return {
    id,
    name: `Ride ${id}`,
    start_date: startIso,
    distance: 42_000,
    moving_time: 5_400,
    elapsed_time: 6_000,
    total_elevation_gain: 320,
    average_watts: 180,
    weighted_average_watts: 210,
    average_heartrate: 140,
    max_heartrate: 172,
    kilojoules: 950
  };
}

const RATE_HEADERS: Record<string, string> = {
  'X-RateLimit-Usage': '10,100',
  'X-RateLimit-Limit': '100,1000'
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 200 ? JSON.stringify(body) : JSON.stringify(body ?? {}), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

type PageHandler = (bearer: string) => Response;
type StreamHandler = (activityId: string, token: string) => StreamFetch | Promise<StreamFetch>;

interface Harness {
  deps: SyncDeps;
  saved: Array<{ cursor?: number; lastSyncAt: number }>;
  page: (handler: PageHandler) => void;
  streamFor: (fn: StreamHandler) => void;
  refresh: (out: { accessToken: string; expiresAt: number } | null) => void;
}

function harness(cursor = 0, token = 'tok-1'): Harness {
  const saved: Array<{ cursor?: number; lastSyncAt: number }> = [];
  let pageHandler: PageHandler = () => jsonResponse(200, [], RATE_HEADERS);
  let streamFn: StreamHandler = () => ({ kind: 'failed' });
  let refreshOut: { accessToken: string; expiresAt: number } | null = null;

  const deps: SyncDeps = {
    token: () => token,
    cursor: () => cursor,
    save: async (patch) => {
      saved.push(patch);
    },
    refresh: async () => refreshOut,
    fetchFn: (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const bearer = (init?.headers as Record<string, string> | undefined)?.authorization?.replace(/^Bearer /, '') ?? '';
      return pageHandler(bearer);
    }) as typeof fetch,
    now: () => NOW,
    fetchStreams: (id, t) => Promise.resolve(streamFn(id, t))
  };

  return {
    deps,
    saved,
    page: (handler) => (pageHandler = handler),
    streamFor: (fn) => (streamFn = fn),
    refresh: (out) => (refreshOut = out)
  };
}

function okResult(res: SyncResult): SyncResult {
  expect(res.ok).toBe(true);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.reset();
  streamsGet.mockResolvedValue(undefined);
  pruner.mockResolvedValue(0);
});

describe('runStravaSync', () => {
  it('refuses to run without a stored token', async () => {
    const h = harness(0, '');
    const res = await runStravaSync({ ...h.deps, token: () => undefined });
    expect(res).toMatchObject({ ok: false, reason: 'not_connected' });
    expect(activitiesPut).not.toHaveBeenCalled();
    expect(h.saved).toEqual([]);
  });

  it('pulls summaries, stores rows with strava provenance, and stamps the cursor + lastSyncAt', async () => {
    const h = harness(0);
    h.page(() => jsonResponse(200, [summary(1, '2026-10-01T02:00:00Z'), summary(2, '2026-10-03T02:00:00Z')], RATE_HEADERS));
    const res = okResult(await runStravaSync(h.deps));

    expect(res.pulled).toBe(2);
    expect(res.streamsFetched).toBe(0);
    expect(activitiesPut).toHaveBeenCalledTimes(2);
    const row = activitiesPut.mock.calls[0][0];
    expect(row.source).toBe('strava');
    expect(row.synthetic).toBe(false);
    // cursor = newest start_date in epoch seconds (2026-10-03T02:00Z); lastSyncAt = now (ms)
    expect(h.saved).toEqual([{ cursor: 1_790_992_800, lastSyncAt: NOW }]);
    // the 7-day pruner ran after the pull
    expect(pruner).toHaveBeenCalledWith(NOW);
  });

  it('reports "up to date" truthfully when upstream has nothing new', async () => {
    const h = harness(1_790_992_800);
    h.page(() => jsonResponse(200, [], RATE_HEADERS));
    const res = okResult(await runStravaSync(h.deps));

    expect(res.pulled).toBe(0);
    expect(h.saved).toEqual([{ cursor: 1_790_992_800, lastSyncAt: NOW }]);
  });

  it('never stamps lastSyncAt when the page fails', async () => {
    const h = harness(0);
    h.page(() => jsonResponse(500, { message: 'boom' }, RATE_HEADERS));
    const res = await runStravaSync(h.deps);

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('network_error');
    expect(h.saved).toEqual([]);
    expect(activitiesPut).not.toHaveBeenCalled();
  });

  it('stops at the 80% guard before writing anything', async () => {
    const h = harness(0);
    // 85 of 100 short-window requests used: over the guard, even though the page returned 200
    h.page(() =>
      jsonResponse(200, [summary(1, '2026-10-01T02:00:00Z')], {
        'X-RateLimit-Usage': '85,100',
        'X-RateLimit-Limit': '100,1000'
      })
    );
    const res = await runStravaSync(h.deps);

    expect(res).toMatchObject({ ok: false, reason: 'rate_limited' });
    expect(res.retryInMs).toBeGreaterThan(0);
    expect(activitiesPut).not.toHaveBeenCalled();
    expect(h.saved).toEqual([]);
  });

  it('reads the newer X-ReadRateLimit headers when Strava sends those instead', async () => {
    const h = harness(0);
    h.page(() =>
      jsonResponse(200, [summary(1, '2026-10-01T02:00:00Z')], {
        'X-ReadRateLimit-Usage': '10,100',
        'X-ReadRateLimit-Limit': '100,1000'
      })
    );
    const res = okResult(await runStravaSync(h.deps));
    expect(res.rateLimit).toMatchObject({ shortUsage: 10, shortLimit: 100, longUsage: 100, longLimit: 1000 });
  });

  it('skips a stream that is already fresh and pulls a missing one, converting seconds to ms', async () => {
    const h = harness(0);
    h.page(() => jsonResponse(200, [summary(1, '2026-10-01T02:00:00Z'), summary(2, '2026-10-02T02:00:00Z')], RATE_HEADERS));

    const start1 = Date.parse('2026-10-01T02:00:00Z');
    streamsGet.mockImplementation(async (id: unknown) =>
      id === '1' ? { id: '1', compressed: new Uint8Array(), fields: [], source: 'strava', updatedAt: start1 + 1 } : undefined
    );
    h.streamFor(async () => ({
      kind: 'ok',
      body: [
        { type: 'time', data: [0, 1, 2] },
        { type: 'watts', data: [100, 110, 120] }
      ]
    }));

    const res = okResult(await runStravaSync(h.deps));
    expect(res.streamsFetched).toBe(1); // only activity 2
    const samples = encode.mock.calls[0][1] as Array<{ t?: number }>;
    expect(samples.map((s) => s.t)).toEqual([0, 1000, 2000]);
  });

  it('carries streamsFetchedAt across a re-pull — a later session must not re-backfill', async () => {
    const h = harness(0);
    h.page(() => jsonResponse(200, [summary(1, '2026-10-01T02:00:00Z')], RATE_HEADERS));
    h.streamFor(async () => ({ kind: 'ok', body: [{ type: 'time', data: [0, 1] }] }));
    await runStravaSync(h.deps);
    expect(store.rows.get('1')?.streamsFetchedAt).toBe(NOW); // stamped by session 1

    // session 2: cursor reset to 0 — the same ride is re-pulled and its row overwritten
    const h2 = harness(0);
    h2.page(() => jsonResponse(200, [summary(1, '2026-10-01T02:00:00Z')], RATE_HEADERS));
    okResult(await runStravaSync(h2.deps));

    // session 3: cursor past everything, upstream empty. The carried stamp must keep
    // the backfill pass from reading the trace as never-fetched and re-downloading it.
    let backfillStreams = 0;
    const h3 = harness(1_790_992_800);
    h3.page(() => jsonResponse(200, [], RATE_HEADERS));
    h3.streamFor(async () => {
      backfillStreams += 1;
      return { kind: 'ok', body: [{ type: 'time', data: [0, 1] }] };
    });
    const res = okResult(await runStravaSync(h3.deps));
    expect(res.streamsBackfilled).toBe(0);
    expect(backfillStreams).toBe(0);
    expect(store.rows.get('1')?.streamsFetchedAt).toBe(NOW);
  });

  it('stops mid-streams when the stream call hits the guard', async () => {
    const h = harness(0);
    h.page(() => jsonResponse(200, [summary(1, '2026-10-01T02:00:00Z')], RATE_HEADERS));
    h.streamFor(async () => ({ kind: 'rate_limited' }));
    const res = await runStravaSync(h.deps);

    expect(res).toMatchObject({ ok: false, reason: 'rate_limited' });
    // the summary row was already stored — but lastSyncAt is not stamped
    expect(activitiesPut).toHaveBeenCalledTimes(1);
    expect(h.saved).toEqual([]);
  });

  it('leaves a stream that fails to decode absent, with the summary row standing', async () => {
    const h = harness(0);
    h.page(() => jsonResponse(200, [summary(1, '2026-10-01T02:00:00Z')], RATE_HEADERS));
    h.streamFor(async () => ({ kind: 'ok', body: [{ type: 'time', data: [0, 1] }, { type: 'watts', data: [1, 2, 3] }] }));
    const res = okResult(await runStravaSync(h.deps));
    expect(res.streamsFetched).toBe(0);
    expect(streamsPut).not.toHaveBeenCalled();
  });

  describe('401 → refresh → retry', () => {
    it('refreshes once and retries the page with the new token', async () => {
      const h = harness(0, 'tok-1');
      h.refresh({ accessToken: 'tok-2', expiresAt: 1_800_003_600 });
      let calls = 0;
      h.page((bearer) => {
        calls++;
        if (bearer === 'tok-1') return jsonResponse(401, { message: 'Unauthorized' });
        return jsonResponse(200, [summary(1, '2026-10-01T02:00:00Z')], RATE_HEADERS);
      });

      const res = okResult(await runStravaSync(h.deps));
      expect(calls).toBe(2);
      expect(res.pulled).toBe(1);
      // the refresh wrote the new token and kept the stored refresh token
      expect(statePut).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'tok-2', refreshToken: 'rt' }));
    });

    it('gives up honestly when the retry is unauthorized too', async () => {
      const h = harness(0, 'tok-1');
      h.refresh({ accessToken: 'tok-2', expiresAt: 1_800_003_600 });
      h.page(() => jsonResponse(401, { message: 'Unauthorized' }));
      const res = await runStravaSync(h.deps);

      expect(res).toMatchObject({ ok: false, reason: 'unauthorized' });
      expect(h.saved).toEqual([]);
    });

    it('reports an unrefreshable token when no refresh token is stored', async () => {
      const h = harness(0, 'tok-1');
      const stateGet = db.sync_state.get as unknown as ReturnType<typeof vi.fn>;
      stateGet.mockResolvedValue({ id: 'strava', accessToken: 'tok-1', updatedAt: 1 });
      h.page(() => jsonResponse(401, { message: 'Unauthorized' }));
      const res = await runStravaSync(h.deps);
      expect(res).toMatchObject({ ok: false, reason: 'token_unrefreshable' });
    });

    it('reports refresh failure when the Function cannot refresh', async () => {
      const h = harness(0, 'tok-1');
      h.refresh(null);
      h.page(() => jsonResponse(401, { message: 'Unauthorized' }));
      const res = await runStravaSync(h.deps);
      expect(res).toMatchObject({ ok: false, reason: 'token_unrefreshable' });
    });
  });

  it('maps 403 to forbidden without writing anything', async () => {
    const h = harness(0);
    h.page(() => jsonResponse(403, { message: 'Forbidden' }, RATE_HEADERS));
    const res = await runStravaSync(h.deps);
    expect(res).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(h.saved).toEqual([]);
  });

  it('maps 429 to rate_limited with the retry delay from the guard headers', async () => {
    const h = harness(0);
    h.page(() => jsonResponse(429, { message: 'Too Many Requests' }, RATE_HEADERS));
    const res = await runStravaSync(h.deps);
    expect(res).toMatchObject({ ok: false, reason: 'rate_limited' });
    expect(res.retryInMs).toBeGreaterThan(0);
  });
});

describe('runStravaSync — backfilling traces for rides the cursor already passed', () => {
  /** A stored ride row as an earlier session would have left it. */
  const stored = (id: string, date: string, source = 'strava') => ({
    id,
    date,
    name: id,
    source,
    distanceKm: 40,
    movingSec: 3600,
    elapsedSec: 3600,
    elevGainM: 200,
    kcal: 800,
    synthetic: false,
    updatedAt: 1
  });

  beforeEach(() => {
    recompute.mockResolvedValue({ scanned: 0, recomputed: 0, curvesComputed: 0, tracesGenerated: 0, noPower: 0 });
  });

  it('pulls traces for older rides that never had one, newest first', async () => {
    const h = harness(0);
    h.page(() => jsonResponse(200, [], RATE_HEADERS)); // nothing new upstream
    store.rows.set('old-1', stored('old-1', '2026-09-01T00:00:00.000Z'));
    store.rows.set('old-2', stored('old-2', '2026-09-02T00:00:00.000Z'));
    store.rows.set('imported', stored('imported', '2026-09-03T00:00:00.000Z', 'gpx'));

    const asked: string[] = [];
    h.streamFor(async (id) => {
      asked.push(id);
      return { kind: 'ok', body: [{ type: 'time', data: [0, 1] }, { type: 'watts', data: [200, 240] }] };
    });

    const res = okResult(await runStravaSync(h.deps));

    expect(res.streamsBackfilled).toBe(2);
    expect(asked).toEqual(['old-2', 'old-1']); // newest first; the imported file is never touched
    expect(store.rows.get('old-1')?.streamsFetchedAt).toBe(NOW);
    expect(store.rows.get('imported')?.streamsFetchedAt).toBeUndefined();
  });

  it('does not re-pull a trace the 7-day pruner deleted on purpose', async () => {
    const h = harness(0);
    h.page(() => jsonResponse(200, [], RATE_HEADERS));
    // marked as fetched once, and the stream row is gone: that is exactly what the pruner
    // leaves behind, and it must not be mistaken for "never fetched"
    store.rows.set('pruned', { ...stored('pruned', '2026-09-05T00:00:00.000Z'), streamsFetchedAt: NOW - 8 * 86_400_000 });

    const asked: string[] = [];
    h.streamFor(async (id) => {
      asked.push(id);
      return { kind: 'ok', body: [{ type: 'time', data: [0] }] };
    });

    const res = okResult(await runStravaSync(h.deps));
    expect(res.streamsBackfilled).toBe(0);
    expect(asked).toEqual([]);
  });

  it('stays within one session budget: the cap is the session, not the history', async () => {
    const h = harness(0);
    h.page(() => jsonResponse(200, [], RATE_HEADERS));
    const asked: string[] = [];
    h.streamFor(async (id) => {
      asked.push(id);
      return { kind: 'ok', body: [{ type: 'time', data: [0] }] };
    });
    for (let i = 0; i < 60; i++) {
      store.rows.set(`r${i}`, stored(`r${i}`, new Date(Date.UTC(2026, 0, 1 + i)).toISOString()));
    }

    const res = okResult(await runStravaSync(h.deps));
    expect(res.streamsBackfilled).toBe(50); // SYNC_BATCH_DEFAULT, the documented session cap
    expect(asked).toHaveLength(50);
    expect(res.streamsBackfilled + res.streamsFetched).toBeLessThanOrEqual(50);
  });

  it('recomputes derived metrics so a fresh trace is not left at "— IF —"', async () => {
    const h = harness(0);
    h.page(() => jsonResponse(200, [summary(7, '2026-09-30T02:00:00Z')], RATE_HEADERS));
    h.streamFor(async () => ({ kind: 'ok', body: [{ type: 'time', data: [0, 1, 2] }, { type: 'watts', data: [150, 220, 180] }] }));
    recompute.mockResolvedValue({ scanned: 1, recomputed: 1, curvesComputed: 1, tracesGenerated: 0, noPower: 0 });

    const res = okResult(await runStravaSync(h.deps));
    expect(recompute).toHaveBeenCalled();
    expect(res.metricsComputed).toBe(2);
  });

  it('keeps the rides when the metric recompute throws — they are already stored', async () => {
    const h = harness(0);
    h.page(() => jsonResponse(200, [summary(8, '2026-09-30T02:00:00Z')], RATE_HEADERS));
    recompute.mockRejectedValue(new Error('quota'));

    const res = okResult(await runStravaSync(h.deps));
    expect(res.pulled).toBe(1);
    expect(h.saved).toEqual([{ cursor: 1_790_733_600, lastSyncAt: NOW }]); // 2026-09-30T02:00Z
  });
});
