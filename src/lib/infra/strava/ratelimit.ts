/**
 * Strava rate-limit guard (ARCHITECTURE.md §6.2).
 *
 * ## The rule this implements
 *
 * Strava publishes two windows per app: a short one (15 minutes) and a daily one. Every
 * response carries the current usage in `X-RateLimit-Usage: <short>,<daily>` against
 * `X-RateLimit-Limit: <short>,<daily>`. The architecture sets the guard at 80% of either
 * window: a sync that crosses it must **stop and schedule a retry**, not press on and get
 * the whole app throttled for the rest of the day.
 *
 * ## Why the threshold is a fraction, not a count
 *
 * The limits belong to the Strava application, not to this device, so several sessions
 * share one budget and the absolute numbers move. Reading them from the headers and
 * comparing against a ratio keeps the guard correct when Strava changes the ceiling, which
 * is the only way a number baked into the source could stay honest.
 *
 * Pure — the caller passes a header getter — so the boundary behaviour can be tested
 * without a network or a browser.
 */

/** Stop when a window passes this fraction of its limit. */
export const THROTTLE_RATIO = 0.8;

/** Strava's short window is fifteen minutes, resetting on the quarter hour (UTC). */
export const SHORT_WINDOW_MS = 15 * 60 * 1000;

export interface RateLimit {
  /** requests used in the current 15-minute window */
  shortUsage: number;
  shortLimit: number;
  /** requests used today */
  longUsage: number;
  longLimit: number;
  /** when the headers were read, epoch ms — the clock the reset math is relative to */
  readAt: number;
}

function pair(value: string | null): [number, number] | null {
  if (!value) return null;
  const parts = value.split(',').map((s) => Number(s.trim()));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0], parts[1]];
}

/**
 * Read both windows off a response.
 *
 * Accepts `X-RateLimit-*` or the newer `X-ReadRateLimit-*`, because Strava added the
 * read-scoped pair and returns whichever applies to the call. Returns `null` when either
 * header is missing or unparsable — an absent budget is *unknown*, not *unlimited*, and the
 * caller must not treat it as permission to keep pulling.
 */
export function parseRateLimit(get: (name: string) => string | null, now = Date.now()): RateLimit | null {
  const limit = pair(get('X-RateLimit-Limit')) ?? pair(get('X-ReadRateLimit-Limit'));
  const usage = pair(get('X-RateLimit-Usage')) ?? pair(get('X-ReadRateLimit-Usage'));
  if (!limit || !usage) return null;
  return {
    shortUsage: usage[0],
    shortLimit: limit[0],
    longUsage: usage[1],
    longLimit: limit[1],
    readAt: now
  };
}

/**
 * Whether the sync must stop.
 *
 * A window whose limit is zero or negative counts as exhausted: it means the header could
 * not be trusted, and continuing on a header we cannot read is how a sync talks itself into
 * the 429 it was written to avoid.
 */
export function shouldThrottle(rl: RateLimit, ratio = THROTTLE_RATIO): boolean {
  if (rl.shortLimit <= 0 || rl.longLimit <= 0) return true;
  return rl.shortUsage >= rl.shortLimit * ratio || rl.longUsage >= rl.longLimit * ratio;
}

/** Remaining requests in the tighter of the two windows — what a batch size should respect. */
export function remainingRequests(rl: RateLimit): number {
  return Math.max(0, Math.min(rl.shortLimit - rl.shortUsage, rl.longLimit - rl.longUsage));
}

/** The next quarter-hour boundary, when the short window resets. */
export function shortWindowResetAt(now: number): number {
  return Math.ceil((now + 1) / SHORT_WINDOW_MS) * SHORT_WINDOW_MS;
}

/**
 * How long to wait before retrying.
 *
 * The short window is the one that frees up first, so the retry is aimed at its boundary.
 * Measured from `readAt` rather than "now" so the delay describes the budget that was
 * actually read, not one that a slow request has already partly outlived.
 */
export function retryDelayMs(rl: RateLimit, now = Date.now()): number {
  const reset = shortWindowResetAt(rl.readAt);
  return Math.max(0, reset - now);
}
