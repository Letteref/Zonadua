/**
 * eFTP auto-suggest (PRD §7) — estimate FTP from the rider's *own* recorded best
 * 20-minute power, propose an update, and let the rider accept or decline.
 *
 * ## Where the numbers come from
 *
 * Each ride with a power trace already has a stored mean-max curve (`power_curves`,
 * ARCHITECTURE.md §5.1). The 1200-second point of that curve *is* that ride's best
 * 20-minute average — so the detector joins rides to their curves and takes the best
 * one inside the window. No trace is re-read and nothing is recomputed here.
 *
 * The estimate reuses `ftpFromTwentyMinuteTest` (×0.95), the same constant the manual
 * calculator in Settings uses — one factor, one home (ARCHITECTURE.md / domain/ftp.ts).
 *
 * ## Rules, stated as assumptions rather than disguised product facts
 *
 * - **Window**: 90 days (EFTP_WINDOW_DAYS), inclusive of the boundary. Older efforts
 *   say little about today's threshold; the rider asked for the recent best.
 * - **Demo rides never suggest**: rows flagged `synthetic` are fabricated seed power
 *   (db.ts: "never real rider data"), so a suggestion built from them would be a fake
 *   metric — the exact thing the app refuses to show elsewhere.
 * - **No threshold for "worth suggesting"**: any whole-watt difference from the current
 *   FTP is offered; whether to take it is the rider's call. An arbitrary ±N% gate would
 *   be an invented business rule.
 * - **Decline is keyed to the evidence** (activity + estimate), not to a timer: "Not
 *   now" hides this exact suggestion until a different best effort produces a different
 *   number. A genuinely new effort is new information and resurfaces.
 *
 * Pure and dependency-free so the whole contract is unit-testable (eftp.test.ts).
 */

import { ftpFromTwentyMinuteTest } from './ftp';

/** The effort window: 20 minutes is the classic field-test duration. */
export const EFTP_EFFORT_SEC = 20 * 60;

/** How far back a "best effort" counts. */
export const EFTP_WINDOW_DAYS = 90;

const DAY_MS = 86_400_000;

/** The ride columns this module needs — structurally typed like the rest of the domain. */
export interface EftpActivityRow {
  id: string;
  date: string;
  name: string;
  /** demo/seed ride with a fabricated power trace — never real rider data */
  synthetic?: boolean;
}

/** The stored curve columns this module needs. */
export interface EftpCurveRow {
  activityId: string;
  points: ReadonlyArray<{ durationSec: number; watts: number }>;
}

/** The qualifying effort a suggestion is built on — also its evidence line. */
export interface EftpEffort {
  activityId: string;
  /** ride name as stored, shown verbatim as the source */
  name: string;
  /** ride date, ISO */
  date: string;
  /** best average power held for the full 20 minutes, watts */
  watts: number;
}

export interface EftpSuggestion {
  effort: EftpEffort;
  /** the proposed FTP: 95% of the effort, rounded to a whole watt */
  estimateFtp: number;
  /** the newest logged FTP, or null when the rider has never logged one */
  currentFtp: number | null;
  /** estimate − current, or null when there is no current FTP to compare against */
  deltaW: number | null;
}

/** What "Not now" stores: the exact suggestion it dismissed. */
export interface EftpDismissal {
  activityId: string;
  ftp: number;
}

/**
 * The best 20-minute effort among rides inside the window.
 *
 * Returns null when nothing qualifies: no rides, nothing recent enough, every candidate
 * is a demo ride, or no ride in the window actually held a full 20-minute window (a
 * curve only carries a 1200 s point when the rider did — meanMaxPower ignores partial
 * trailing windows, so a short ride simply has no point and is skipped, not zeroed).
 *
 * Ties (identical watts) go to the newer ride: it is the more current evidence.
 */
export function bestTwentyMinuteEffort(
  activities: ReadonlyArray<EftpActivityRow>,
  curves: ReadonlyArray<EftpCurveRow>,
  nowMs: number
): EftpEffort | null {
  const cutoff = nowMs - EFTP_WINDOW_DAYS * DAY_MS;
  const curveByActivity = new Map(curves.map((c) => [c.activityId, c]));

  let best: EftpEffort | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;

  for (const act of activities) {
    // seed power is fabricated; suggesting from it would be a made-up metric
    if (act.synthetic) continue;
    const at = Date.parse(act.date);
    if (!Number.isFinite(at) || at < cutoff) continue;

    const points = curveByActivity.get(act.id)?.points;
    if (!points) continue;
    const point = points.find((p) => p.durationSec === EFTP_EFFORT_SEC);
    // ride too short (or no power): no qualifying window, not a zero-watt effort
    if (!point || !(point.watts > 0)) continue;

    const wins =
      best === null ||
      point.watts > best.watts ||
      (point.watts === best.watts && at > bestAt);
    if (wins) {
      best = { activityId: act.id, name: act.name, date: act.date, watts: point.watts };
      bestAt = at;
    }
  }
  return best;
}

/**
 * Turn a qualifying effort into an offer, or null when there is nothing to offer:
 * the factor cannot produce a positive FTP (defensive — the effort is already > 0),
 * or the estimate equals what is already logged (accepting would change nothing).
 */
export function suggestEftp(effort: EftpEffort, currentFtp: number | null): EftpSuggestion | null {
  const estimateFtp = ftpFromTwentyMinuteTest(effort.watts);
  if (estimateFtp === null) return null;
  if (currentFtp !== null && estimateFtp === currentFtp) return null;
  return {
    effort,
    estimateFtp,
    currentFtp,
    deltaW: currentFtp === null ? null : estimateFtp - currentFtp
  };
}

/** Whether "Not now" already covered this exact suggestion (same ride, same estimate). */
export function isEftpDismissed(
  dismissal: EftpDismissal | undefined,
  suggestion: EftpSuggestion
): boolean {
  if (!dismissal) return false;
  return (
    dismissal.activityId === suggestion.effort.activityId &&
    dismissal.ftp === suggestion.estimateFtp
  );
}
