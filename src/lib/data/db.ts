import Dexie, { type EntityTable } from 'dexie';

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
  odometerKm: number;
  active: boolean;
  notes?: string;
  updatedAt: number;
}

export interface BikeComponent {
  id: string;
  bikeId: string;
  name: string;
  kind: string; // chain | brake-pads | tires | cassette | ...
  installedAtOdoKm: number;
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
  avgHr?: number;
  maxHr?: number;
  kcal: number;
  commute?: boolean;
  flagged?: boolean;
  notes?: string;
  /** demo/seed ride with a synthetic power trace — never real rider data */
  synthetic?: boolean;
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
