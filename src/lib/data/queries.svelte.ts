import { liveQuery, type Observable } from 'dexie';
import { db, type Activity, type BikeComponent, type WeightLog } from './db';
import { DEFAULT_POWER_ZONES, bandsFromStops, stopsFromBands } from '../domain/zones';
import { inflateJson } from './streams';
import type { ProfilePoint } from '../domain/physics';

/**
 * Rune-friendly wrapper around Dexie liveQuery.
 * App-lifetime subscriptions: created once at module init, reactive via $state.
 */
function wrap<T>(lq: Observable<T>): { current: T | undefined; ready: boolean } {
  let current = $state<T | undefined>(undefined);
  let ready = $state(false);
  const unsub = lq.subscribe({
    next: (v) => {
      current = v;
      ready = true;
    },
    error: (e) => console.error('[gowslab] liveQuery error:', e)
  });
  if (import.meta.hot) {
    import.meta.hot.on('vite:beforeFullReload', () => unsub.unsubscribe());
  }
  return {
    get current() {
      return current;
    },
    get ready() {
      return ready;
    }
  };
}

/** Recent activities, newest first. */
export const recentActivities = wrap(
  liveQuery(async () => db.activities.orderBy('date').reverse().limit(8).toArray())
);

/** All activities — used for weekly aggregation & PMC. */
export const allActivities = wrap(liveQuery(async () => db.activities.toArray()));

/** Active bike + its components. */
export const activeBike = wrap(
  liveQuery(async () => {
    const bikes = await db.bikes.toArray();
    const bike = bikes.find((b) => b.active) ?? bikes[0];
    if (!bike) return undefined;
    const components = await db.components.where('bikeId').equals(bike.id).toArray();
    return { bike, components };
  })
);

/** All bikes (for setup selectors). */
export const allBikes = wrap(liveQuery(async () => db.bikes.toArray()));

/** All bikes joined with their components (Gear page). */
export const allBikesWithComponents = wrap(
  liveQuery(async () => {
    const bikes = await db.bikes.toArray();
    const comps = await db.components.toArray();
    return bikes.map((bike) => ({
      bike,
      components: comps.filter((c) => c.bikeId === bike.id)
    }));
  })
);

/** Weight log series, oldest first. */
export const weightSeries = wrap(liveQuery(async () => db.weight_log.orderBy('date').toArray()));

export const latestFtp = wrap(
  liveQuery(async () => {
    const rows = await db.ftp_history.orderBy('date').toArray();
    return rows.at(-1);
  })
);

/** Full FTP history (for derived deltas on the snapshot). */
export const ftpSeries = wrap(liveQuery(() => db.ftp_history.orderBy('date').toArray()));

/** All stored routes (dashboard race card needs the route distance). */
export const allRoutes = wrap(liveQuery(() => db.routes.toArray()));

/** Per-activity mean-max power curves (M2). Merged into one curve by the domain layer. */
export const powerCurves = wrap(liveQuery(() => db.power_curves.toArray()));

export const athlete = wrap(liveQuery(() => db.athlete.get('me')));

export const appSettings = wrap(liveQuery(() => db.settings.get('app')));

/**
 * Active power zone bands (F2-AC4). Reads the newest stored zone set, falling back to the
 * default template when the athlete has not customised anything yet.
 */
export const powerZones = wrap(
  liveQuery(async () => {
    const rows = await db.zones.where('type').equals('power').toArray();
    const latest = rows.sort((a, b) => b.version - a.version)[0];
    if (!latest || latest.zones.length === 0) return [...DEFAULT_POWER_ZONES];
    return bandsFromStops(stopsFromBands(latest.zones));
  })
);

export const syncState = wrap(liveQuery(() => db.sync_state.get('strava')));

/**
 * Decode a stored route into the physics profile ([km, alt] pairs written by Routes).
 * Returns [] when the row is missing or corrupt — the caller shows an honest empty state
 * rather than a fabricated route.
 */
export async function fetchRouteProfile(routeId: string | undefined): Promise<ProfilePoint[]> {
  if (!routeId || routeId === 'stub-route') return [];
  try {
    const row = await db.routes.get(routeId);
    if (!row) return [];
    const parsed = (await inflateJson(row.pointsCompressed)) as Array<[number, number]>;
    if (!Array.isArray(parsed) || parsed.length < 2) return [];
    return parsed.map(([distKm, altM]) => ({ distKm: Number(distKm), altM: Number(altM) }));
  } catch (e) {
    console.error('[gowslab] route profile decode failed:', e);
    return [];
  }
}

/** Soonest upcoming race (planned or live) — reminder bell countdown. */
export const nextRace = wrap(
  liveQuery(async () => {
    const rows = await db.races.where('status').anyOf(['planned', 'live']).sortBy('startTime');
    return rows[0];
  })
);

export interface WeekTotals {
  tss: number;
  hours: number;
  km: number;
  dailyTss: { date: string; tss: number }[];
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Aggregates for the last 7 days including per-day TSS. */
export function computeWeek(items: Activity[]): WeekTotals {
  const now = new Date();
  const days: { date: string; tss: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    days.push({ date: isoDay(d), tss: 0 });
  }
  const cutoff = new Date(now);
  cutoff.setDate(now.getDate() - 6);
  cutoff.setHours(0, 0, 0, 0);
  const byDate = new Map(days.map((d) => [d.date, d]));
  let tss = 0;
  let secs = 0;
  let km = 0;
  for (const a of items) {
    const d = new Date(a.date);
    if (d < cutoff) continue;
    const key = isoDay(d);
    const bucket = byDate.get(key);
    const dayTss = a.tss ?? 0;
    tss += dayTss;
    secs += a.movingSec;
    km += a.distanceKm;
    if (bucket) bucket.tss += dayTss;
  }
  return { tss, hours: Math.round((secs / 3600) * 10) / 10, km: Math.round(km), dailyTss: days };
}

export interface ComponentWear {
  comp: BikeComponent;
  usedKm: number;
  pct: number;
  status: 'aman' | 'waspada' | 'kritis';
  leftKm: number;
}

/** Wear model per UI-SPEC: KRITIS at >=100% of interval, WASPADA at >=90%. */
export function computeWear(comp: BikeComponent, odoKm: number): ComponentWear {
  const usedKm = Math.max(0, odoKm - comp.installedAtOdoKm);
  const pct = Math.min(1.5, usedKm / comp.intervalKm);
  const status = pct >= 1 ? 'kritis' : pct >= 0.9 ? 'waspada' : 'aman';
  return { comp, usedKm, pct, status, leftKm: Math.round(comp.intervalKm - usedKm) };
}

/**
 * CTL/ATL/TSB — the PMC now lives in the domain layer (ARCHITECTURE.md §5.2) with unit
 * tests; this re-export keeps every existing import site working unchanged.
 */
export { computePmc, formState } from '../domain/pmc';

export function latestWeight(logs: WeightLog[]): { current: number; delta: number } | undefined {
  if (logs.length === 0) return undefined;
  const current = logs.at(-1)!.kg;
  const prev = logs.length > 1 ? logs.at(-2)!.kg : current;
  return { current, delta: Math.round((current - prev) * 10) / 10 };
}
