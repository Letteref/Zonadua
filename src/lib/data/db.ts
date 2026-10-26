import Dexie, { type EntityTable } from 'dexie';
import { migrateOdometerToBaseline } from './odometer';

/**
 * Zonadua local-first database (ARCHITECTURE.md §4, schema v1).
 * Every record carries an `id` (nanoid-style, generated at repo layer) and `updatedAt`.
 */

export type ActivitySource = 'strava' | 'gpx' | 'tcx' | 'fit' | 'manual';
export type BikeType = 'road' | 'gravel' | 'mtb';
export type ZoneType = 'hr' | 'power';
export type RaceStatus = 'planned' | 'live' | 'finished';
export type AiNoteKind = 'review' | 'plan' | 'chat';

export interface Athlete {
  id: 'me';
  name: string;
  sex: 'm' | 'f' | 'x';
  birthDate: string; // ISO date
  heightCm: number;
  restingHr?: number;
  maxHr?: number;
  updatedAt: number;
}

export interface WeightLog {
  id: string;
  date: string; // ISO date
  kg: number;
  updatedAt: number;
}

export interface FtpHistory {
  id: string;
  date: string; // ISO date
  ftp: number; // watts
  updatedAt: number;
}

export interface ZoneSet {
  id: string;
  type: ZoneType;
  version: number;
  zones: { name: string; min?: number; max?: number }[];
  updatedAt: number;
}

export interface Bike {
  id: string;
  name: string;
  type: BikeType;
  weightKg: number;
  crr: number;
  cda: number;
  /**
   * The distance that is *not* in the activity table: the reading when tracking began,
   * typed in the Gear form. The odometer shown to the rider is `baselineKm + Σ distanceKm`
   * of the activities attributed to this bike — derived, never a counter to keep in sync
   * (see data/odometer.ts for the math and why the old `odometerKm` increment is gone).
   * The schema-v3 migration fills this from the old counter without moving the displayed
   * total; backup restore of a pre-v3 file runs the same conversion.
   */
  baselineKm: number;
  active: boolean;
  notes?: string;
  updatedAt: number;
}

export interface BikeComponent {
  id: string;
  bikeId: string;
  name: string;
  kind: string; // chain | brake-pads | tires | cassette | ...
  /**
   * Provenance: the odometer reading when this part physically went on. The Service
   * button never writes here — a chain that goes on at 4 412 km and gets relubed every
   * 300 km must still say "installed at 4 412" a year later.
   */
  installedAtOdoKm: number;
  /**
   * The service clock: the odometer reading at the most recent Service press. Absent =
   * never serviced since install, so wear counts from `installedAtOdoKm`. Rows written
   * before this field existed simply lack it and behave exactly as they did.
   */
  lastServiceAtOdoKm?: number;
  intervalKm: number;
  notes?: string;
  updatedAt: number;
}

export interface Activity {
  id: string;
  date: string; // ISO datetime
  name: string;
  source: ActivitySource;
  bikeId?: string;
  distanceKm: number;
  movingSec: number;
  elapsedSec: number;
  elevGainM: number;
  avgPower?: number;
  np?: number;
  if?: number;
  tss?: number;
  /**
   * True when np/if/tss (or just tss) came from the speed/elevation estimator, not a
   * power trace. Estimated load keeps PMC/dashboard working before meter data arrives,
   * but the UI must label it — a rider comparing yesterday's "TSS 61" against a metered
   * ride deserves to know one of those numbers was modelled from a physics guess.
   * Absent = measured (or not scored at all).
   */
  tssEstimated?: boolean;
  avgHr?: number;
  maxHr?: number;
  kcal: number;
  commute?: boolean;
  /**
   * Strava sport type (`Ride`, `VirtualRide`, `Walk`, …). Stored so activities the sync
   * pulls that are not riding — the athlete's walks, runs — can be excluded from riding
   * statistics instead of silently inflating them. Absent on imported files and on rows
   * written before this field existed; absence counts as a ride (see `isCyclingActivity`).
   */
  sportType?: string;
  flagged?: boolean;
  notes?: string;
  /** demo/seed ride with a synthetic power trace — never real rider data */
  synthetic?: boolean;
  /**
   * When this ride's raw trace was last pulled from the API (epoch ms).
   *
   * Written only by a Strava sync, and only when the fetch actually produced a usable
   * stream. Its absence is the signal for the backfill pass — this ride never had its
   * trace — which is deliberately *not* the same as "no stream row": the 7-day pruner
   * deletes API traces on purpose, and a device that re-pulled them every session would
   * quietly undo the cache policy Strava's terms ask for.
   */
  streamsFetchedAt?: number;
  /**
   * LEGACY (pre-v3): epoch ms when this ride's kilometres were added to the old
   * increment counter.
   *
   * The odometer is derived now (`baselineKm + Σ distanceKm`), so new rides never need
   * this stamp — attribution alone counts them, and attribution is idempotent under the
   * sync's row overwrite. It survives for one job: a row carrying it was *already* baked
   * into the migrated baseline, so neither the migration nor a later sync may attribute
   * it to a bike — doing so would count it twice, once inside the baseline and once
   * inside the sum. The v3 migration attributes stamped rows it can place (active bike)
   * and adjusts the baseline by the same amount, preserving the displayed total.
   */
  odometerCreditedAt?: number;
  /** version of lib/domain/metrics that produced np/if/tss (see METRICS_VERSION) */
  mVersion?: number;
  updatedAt: number;
}

/**
 * Provenance label for an activity, as shown to the rider.
 *
 * The seeder marks its demo rides `synthetic: true` but writes `source: 'strava'` on
 * half of them, so rendering `activity.source` put a **STRAVA** badge on rides that were
 * generated locally and have never been near Strava. Every dashboard number — CTL, TSS,
 * CP/W' — traces back to those rides, so the badge was not a cosmetic detail: it was the
 * app claiming a provenance it did not have.
 *
 * `synthetic` wins over `source` because it is the field that means "this was not
 * measured". Reading it here means every surface gets the same honest answer, and rows
 * written by an older build are corrected on display rather than needing a migration.
 */
export function activityProvenance(act: Pick<Activity, 'source' | 'synthetic'>): string {
  return act.synthetic ? 'demo' : act.source;
}

/**
 * Strava sport types that are cycling. Everything else a sync can pull (Walk, Hike,
 * Run, Swim…) is real activity but not riding, and must not inflate riding statistics.
 */
export const CYCLING_SPORT_TYPES: ReadonlySet<string> = new Set([
  'Ride',
  'VirtualRide',
  'EBikeRide',
  'MountainBikeRide',
  'GravelRide',
  'Handcycle'
]);

/**
 * Whether this row counts toward riding statistics.
 *
 * An absent `sportType` means "known to be a ride": GPX/TCX/FIT imports and manual
 * entries are rides by definition, and rows synced before the type was stored cannot
 * be reclassified from what is on the device — excluding them would silently rewrite
 * history. Only an explicitly non-cycling Strava type is excluded.
 */
export function isCyclingActivity(act: { sportType?: string }): boolean {
  return act.sportType === undefined || CYCLING_SPORT_TYPES.has(act.sportType);
}

export interface ActivityStreams {
  id: string; // = activityId
  /** deflated JSON of typed arrays/arrays: { time, lat?, lng?, alt?, watts?, hr?, cad? } */
  compressed: Uint8Array;
  fields: string[];
  /** 'strava' streams obey the 7-day API cache policy (ARCHITECTURE.md §6); file imports don't */
  source: ActivitySource;
  /** present only on traces produced by lib/data/synthetic.ts — never on real rider data */
  synthVersion?: number;
  updatedAt: number;
}

export interface Route {
  id: string;
  name: string;
  distanceKm: number;
  elevGainM: number;
  /** deflated JSON of points [{lat, lng, alt, dist}] */
  pointsCompressed: Uint8Array;
  /**
   * deflated JSON of `{km, lat, lng}` for every GPS fix — the live race map's track.
   * Absent on rows written before this field existed (and on schema-less profile-only
   * imports); the map hides itself rather than drawing a fabrication.
   */
  trackCompressed?: Uint8Array;
  pointCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface RaceCheckpoint {
  km: number;
  cutoffMin?: number; // minutes after start
  label?: string;
}

export interface Race {
  id: string;
  routeId: string;
  name: string;
  startTime: string; // ISO datetime
  cutoffFinishMin: number; // minutes after start
  checkpoints: RaceCheckpoint[];
  planJson?: string;
  status: RaceStatus;
  updatedAt: number;
}

export interface RaceLog {
  id: string;
  raceId: string;
  at: number; // epoch seconds
  km: number;
  note?: string;
  updatedAt: number;
}

export interface AiNote {
  id: string;
  kind: AiNoteKind;
  content: string;
  contextJson?: string;
  createdAt: number;
}

export interface PowerCurve {
  id: string; // = activityId
  activityId: string;
  /** mean-max power points, ascending by duration */
  points: { durationSec: number; watts: number }[];
  /** version of lib/domain/power-curve that produced these points */
  version: number;
  updatedAt: number;
}

export interface SyncState {
  id: 'strava';
  lastSyncAt?: number;
  cursor?: number;
  rateWindow?: string;
  /**
   * OAuth credentials from the code↔token exchange (ARCHITECTURE.md §6.1).
   *
   * Stored in IndexedDB like everything else: they are read by this device only, sent to
   * Strava only, and never included in an export or the AI context (§5.5). They need no
   * Dexie index, so adding them here does not require a schema version bump — the row is
   * simply written with more fields.
   */
  accessToken?: string;
  refreshToken?: string;
  /** epoch seconds, Strava's own `expires_at` clock */
  expiresAt?: number;
  athleteId?: number;
  updatedAt: number;
}

export interface Settings {
  id: 'app';
  unit: 'metric' | 'imperial';
  theme: 'dark' | 'light' | 'auto';
  lang: 'en' | 'id';
  aiProvider?: 'gemini' | 'openai' | 'openrouter' | 'anthropic';
  aiKey?: string;
  weatherOn: boolean;
  /** last successful JSON backup (epoch ms) — drives the bell reminder (PRD §10) */
  lastBackupAt?: number;
  /**
   * Onboarding preferences (step 4). Both are rider-stated intent, not measurements, so they
   * are absent on any device that never ran the flow. They need no Dexie index, so adding
   * them here does not require a schema version bump.
   */
  /** experience archetype key — 'foundation' | 'structured' | 'performance' */
  archetype?: string;
  /** the weekly distance the rider said they aim to ride, in km — the planning baseline */
  weeklyTargetKm?: number;
  /**
   * The eFTP suggestion the rider declined — the *evidence* it stood on (source activity
   * + proposed FTP), so the same offer stays hidden until a different best effort
   * produces a different number. Not an index; like the fields above it needs no schema
   * version bump (see the comment on `archetype`).
   */
  eftpDismiss?: { activityId: string; ftp: number };
  /**
   * CP/W′ the rider typed in themselves, for the meter they do not own.
   *
   * Two parameters cannot be identified from a mean-max curve that does not exist, and
   * the app refuses to synthesise one from ride averages — that collapses to W′ ≈ 0 and
   * would print a verdict built on nothing. So a rider without power *states* the pair,
   * the capability card consumes it only when no curve fits, and every surface labels it
   * "entered" rather than "fitted". Absent on any device that never typed one, where the
   * card keeps its honest "No CP fit".
   *
   * `cp` is watts and `wPrime` is joules, matching `CriticalPowerFit`. Not an index, so
   * adding it needs no schema bump (see the comment on `archetype`).
   */
  manualCpW?: { cp: number; wPrime: number };
  updatedAt: number;
}

// The database was renamed with the app (`gowslab` → `zonadua`). Nothing migrates across:
// a browser keeps the old database until it is deleted, and the seeder repopulates the new
// one on first boot. That is only safe while the contents are demo data — see
// docs/ROADMAP.md before shipping a rename like this to anyone with real rides in it.
export const db = new Dexie('zonadua') as Dexie & {
  athlete: EntityTable<Athlete, 'id'>;
  weight_log: EntityTable<WeightLog, 'id'>;
  ftp_history: EntityTable<FtpHistory, 'id'>;
  zones: EntityTable<ZoneSet, 'id'>;
  bikes: EntityTable<Bike, 'id'>;
  components: EntityTable<BikeComponent, 'id'>;
  activities: EntityTable<Activity, 'id'>;
  activity_streams: EntityTable<ActivityStreams, 'id'>;
  power_curves: EntityTable<PowerCurve, 'id'>;
  routes: EntityTable<Route, 'id'>;
  races: EntityTable<Race, 'id'>;
  race_logs: EntityTable<RaceLog, 'id'>;
  ai_notes: EntityTable<AiNote, 'id'>;
  sync_state: EntityTable<SyncState, 'id'>;
  settings: EntityTable<Settings, 'id'>;
};

db.version(1).stores({
  athlete: 'id',
  weight_log: 'id, date',
  ftp_history: 'id, date',
  zones: 'id, type',
  bikes: 'id, name',
  components: 'id, bikeId',
  activities: 'id, date, bikeId, source',
  activity_streams: 'id',
  routes: 'id, name, createdAt',
  races: 'id, routeId, status',
  race_logs: 'id, raceId, at',
  ai_notes: 'id, kind, createdAt',
  sync_state: 'id',
  settings: 'id'
});

/** v2: mean-maximal power curve per activity (M2, ARCHITECTURE.md §5.1). */
db.version(2).stores({
  power_curves: 'id, activityId'
});

/**
 * v3: the bike odometer becomes derived (data/odometer.ts).
 *
 * `bikes.odometerKm` was a counter every writer had to increment — import, sync, and the
 * rider's own edits each held a piece of the truth, and deleting a ride left the counter
 * lying. The stored term is now only the *baseline* (distance from before tracking), and
 * the displayed odometer adds every ride attributed to the bike, so delete and re-sync
 * are correct without any writer knowing.
 *
 * The upgrade converts in place, through the pure `migrateOdometerToBaseline`: rides the
 * old counter had already counted (the sync stamped them `odometerCreditedAt`) are
 * attributed to the active bike, then each bike's counter becomes `baseline = counter −
 * Σ its rides` — so the figure the rider reads does not move by a single kilometre. No
 * index changes, hence the empty stores() — this version exists for the data conversion.
 */
db.version(3).stores({}).upgrade(async (tx) => {
  const bikes = await tx.table<Bike, 'id'>('bikes').toArray();
  if (bikes.length === 0) return;
  const activities = await tx.table<Activity, 'id'>('activities').toArray();
  const migrated = migrateOdometerToBaseline(bikes, activities, isCyclingActivity);
  for (const a of migrated.activities) await tx.table<Activity, 'id'>('activities').put(a);
  for (const b of migrated.bikes) await tx.table<Bike, 'id'>('bikes').put(b);
});
