/**
 * What to say about Strava sync when there is nothing (or little) to show.
 *
 * ## Why this is a pure function
 *
 * The app boots with no activities in production — the demo data is dev-only — so the first
 * thing a new rider sees is an empty log. "Empty" is ambiguous: it can mean *this app has no
 * data yet*, or *this app is broken*, or *your rides are somewhere else*. A status line is
 * what turns that ambiguity into an instruction, and it has to be honest in both directions:
 *
 *   - never synced → say so, and name file import as the path that works today
 *   - synced recently → say so, so an empty week reads as "you have not ridden" rather than
 *     "sync is broken"
 *   - synced long ago → say it needs a sync, with the age, so staleness is visible
 *
 * The wording lives here instead of in the components so every surface that reports sync
 * gives the same answer, and so the thresholds can be tested without rendering anything.
 *
 * `now` is injected: a function that reads the clock cannot be tested at the boundaries.
 */

export type SyncTone = 'neutral' | 'warn' | 'ok';

export interface SyncStatus {
  tone: SyncTone;
  /** short chip/label text */
  label: string;
  /** one sentence of guidance, already written, for the caller to render verbatim */
  detail: string;
}

/** A sync older than this reads as stale rather than current. */
export const STALE_SYNC_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 86_400_000;

/** "just now" / "3 h ago" / "5 days ago" — only used for whole past durations. */
export function relativeAge(from: number, now: number): string {
  const ms = Math.max(0, now - from);
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < DAY_MS) return `${Math.floor(ms / 3_600_000)} h ago`;
  const days = Math.floor(ms / DAY_MS);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * Derive the sync status from a stored `SyncState` (or its absence).
 *
 * An absent row and a row with no `lastSyncAt` mean the same thing to a rider — nothing has
 * ever come down — so they collapse to one answer.
 */
export function syncStatus(
  sync: { lastSyncAt?: number } | null | undefined,
  now = Date.now()
): SyncStatus {
  const last = sync?.lastSyncAt;

  if (typeof last !== 'number' || !Number.isFinite(last)) {
    return {
      tone: 'warn',
      label: 'Not synced yet',
      detail: 'No Strava sync on this device yet. Import a GPX/TCX file, or connect Strava to pull your rides.'
    };
  }

  const age = now - last;
  const when = relativeAge(last, now);

  if (age > STALE_SYNC_MS) {
    return {
      tone: 'warn',
      label: 'Needs sync',
      detail: `Last Strava sync was ${when}. Re-sync to pull anything newer — imported files stay as they are.`
    };
  }

  return {
    tone: 'ok',
    label: `Synced ${when}`,
    detail: 'Strava is up to date. An empty day means no ride was recorded, not a missed sync.'
  };
}
