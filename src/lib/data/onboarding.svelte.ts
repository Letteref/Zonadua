/**
 * Onboarding state — the completion flag, the draft progress, and the writes each step makes.
 *
 * Two separate stores, deliberately:
 *
 * - The **completion flag, the landing-seen flag and the draft step** live in `localStorage`, outside Dexie. This is the
 *   same reasoning as the seed/wipe flags in `seed.ts`: the flag must survive "Erase
 *   everything" (a rider who wiped their log has still seen the app and should not be
 *   re-onboarded), and it must be readable synchronously during boot before the database is
 *   open, so `App.svelte` can decide between the onboarding shell and the app without an
 *   extra async hop.
 *
 * - The **answers themselves** are written straight into the real tables they belong to
 *   (`athlete`, `weight_log`, `ftp_history`, `settings`) as the rider gives them, rather than
 *   staged in a side table. Each step writes on Continue, so a rider who quits halfway keeps
 *   everything they entered, and the app never has to reconcile a draft against real rows.
 */
import { db, type Athlete, type Settings, type WeightLog, type FtpHistory } from './db';
import { newId } from './seed';

const ONBOARDED_FLAG = 'zonadua.onboarded';
const DRAFT_STEP_KEY = 'zonadua.onboarding.step';
const LANDING_SEEN_KEY = 'zonadua.landing.seen';

/** Number of steps in the flow, shared by the shell and the progress indicator. */
export const ONBOARDING_STEPS = 5;

/** Whether this device has finished (or skipped) onboarding. True also when storage is gone. */
export function isOnboarded(): boolean {
  if (typeof localStorage === 'undefined') return true; // SSR / no storage: assume done
  return localStorage.getItem(ONBOARDED_FLAG) === '1';
}

/** Mark onboarding complete. Idempotent. */
export function markOnboarded(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(ONBOARDED_FLAG, '1');
  localStorage.removeItem(DRAFT_STEP_KEY);
}

/**
 * Whether the welcome landing has already been dismissed on this device.
 *
 * False on a fresh profile — the landing is the first screen. True from the moment
 * "Get started" is pressed, so a reload halfway through setup resumes the setup instead
 * of pitching the app a second time. Assumes seen when storage is unavailable, matching
 * `isOnboarded`'s "a device without storage has already been through first run".
 */
export function hasSeenLanding(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(LANDING_SEEN_KEY) === '1';
}

/** Dismiss the welcome landing. Idempotent. */
export function markLandingSeen(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LANDING_SEEN_KEY, '1');
}

/**
 * Forget first run, so the next boot replays it: the welcome landing, then the flow.
 * Used by the Settings "Run setup again" action. The rider's data is untouched — the flow
 * just re-asks and overwrites.
 */
export function resetOnboarding(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(ONBOARDED_FLAG);
  localStorage.removeItem(LANDING_SEEN_KEY);
  localStorage.removeItem(DRAFT_STEP_KEY);
}

/** The step the rider last reached, 0-indexed. Clamped to the valid range. */
export function draftStep(): number {
  if (typeof localStorage === 'undefined') return 0;
  const raw = Number.parseInt(localStorage.getItem(DRAFT_STEP_KEY) ?? '0', 10);
  if (!Number.isFinite(raw)) return 0;
  return Math.min(Math.max(raw, 0), ONBOARDING_STEPS - 1);
}

/** Remember how far the rider got, so closing the tab mid-flow resumes where they left. */
export function saveDraftStep(step: number): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(DRAFT_STEP_KEY, String(Math.min(Math.max(step, 0), ONBOARDING_STEPS - 1)));
}

/** Local calendar day, `YYYY-MM-DD`, matching how `weight_log` and `ftp_history` are keyed. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Read the current athlete row, or the shape a first-boot device will get. */
export async function loadAthlete(): Promise<Athlete> {
  const existing = await db.athlete.get('me');
  if (existing) return existing;
  return {
    id: 'me',
    name: '',
    sex: 'x',
    birthDate: '',
    heightCm: 0,
    updatedAt: Date.now()
  };
}

export interface Biometrics {
  weightKg: number;
  heightCm: number;
  birthYear: number;
}

/**
 * Step 1 — body mass, stature, birth year.
 *
 * Weight goes into `weight_log` as today's entry (same door Settings uses), so the body
 * trend has a first real point instead of a fabricated history. Birth year becomes a
 * mid-year date because the table stores an ISO date and only the year is known; the UI
 * never shows the day, and `ageFromBirthYear` reads the year back out.
 */
export async function saveBiometrics(b: Biometrics): Promise<void> {
  const now = Date.now();
  const weight: WeightLog = { id: newId(), date: todayIso(), kg: b.weightKg, updatedAt: now };
  await db.weight_log.put(weight);

  const athlete = await loadAthlete();
  const patched: Athlete = {
    ...athlete,
    heightCm: b.heightCm,
    birthDate: b.birthYear > 0 ? `${b.birthYear}-07-01` : athlete.birthDate,
    updatedAt: now
  };
  await db.athlete.put(patched);
}

export interface HeartRate {
  restingHr: number;
  maxHr: number;
}

/** Step 2 — resting and maximum heart rate, onto the athlete row. */
export async function saveHeartRate(h: HeartRate): Promise<void> {
  const now = Date.now();
  const athlete = await loadAthlete();
  await db.athlete.put({ ...athlete, restingHr: h.restingHr, maxHr: h.maxHr, updatedAt: now });
}

/**
 * Step 3 — FTP, when the rider has a power meter and a 20-minute number.
 *
 * Mirrors Settings' Log FTP: one row in `ftp_history` dated today. Returns the stored FTP,
 * or null when the input was unusable (so the caller can keep going without a threshold).
 */
export async function saveFtp(ftpW: number): Promise<number | null> {
  if (!Number.isFinite(ftpW) || ftpW <= 0) return null;
  const rec: FtpHistory = { id: newId(), date: todayIso(), ftp: Math.round(ftpW), updatedAt: Date.now() };
  await db.ftp_history.put(rec);
  return rec.ftp;
}

export interface TrainingPlan {
  archetype: string;
  weeklyTargetKm: number;
}

/**
 * Step 4 — experience archetype and weekly volume target, onto the settings row.
 *
 * These are preferences, not measurements, so they live with the rest of the rider's
 * settings. `weeklyTargetKm` is written here and read by the dashboard's weekly-target card
 * as the planning baseline before any ride history exists to derive one from.
 */
export async function savePlan(p: TrainingPlan): Promise<void> {
  const now = Date.now();
  const existing = await db.settings.get('app');
  const base: Settings = existing ?? {
    id: 'app',
    unit: 'metric',
    theme: 'dark',
    lang: 'en',
    weatherOn: true,
    updatedAt: now
  };
  await db.settings.put({ ...base, archetype: p.archetype, weeklyTargetKm: p.weeklyTargetKm, updatedAt: now });
}
