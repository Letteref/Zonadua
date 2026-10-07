/**
 * Strava-first auto-sync — rides enter through Strava without a button press.
 *
 * ## What "Strava is the primary pipeline" means here
 *
 * Every calculation the app performs — NP/IF/TSS, CTL/ATL/TSB, the mean-max curve, the
 * CP/W′ model — reads the same Dexie tables no matter which door the ride came through.
 * The numbers were never the problem; the *door* was. The sync loop existed, but the rider
 * had to walk to Settings and press Sync now, and every empty state pointed at file import
 * first. From this build the boot gate makes the door open by itself: launch, connect token
 * present → the app syncs on its own, and the log fills with Strava rides whose metrics
 * are computed through the exact same domain path as before.
 *
 * ## The gate
 *
 * Auto-sync is gated, not blind. It must have:
 *  - a stored access token (not connected → stay silent, do not nag a stranger),
 *  - a completed boot (Dexie schema open — the caller awaits `ensureSeeded()` first),
 *  - network reachability (`navigator.onLine === false` → stay silent),
 *  - and no sync session already running in this tab (`sessionFlag === 'syncing'`).
 *
 * It deliberately does *not* require a "stale" timestamp. A rider who opened the app five
 * minutes after their last sync gets a cheap, quiet session anyway: the cursor makes a
 * redundant sync one page request long, and freshness is the whole point of a primary
 * pipeline. The per-tab cost is bounded three ways — the session marker set by
 * `runAutoSync`, the cooldown window, and the sync loop's own 80% header guard, which is
 * the only honest budget check there is: Strava's numbers arrive on responses, not before
 * them, so a gate that claimed to read them pre-flight would be inventing permission.
 *
 * The gate is a pure function so every rule is unit-testable without a browser, Dexie, or
 * a Strava — the same convention as `status.ts`.
 */

import { db } from '../../data/db';
import { runLiveSync } from './runSync';

/** sessionStorage marker: this tab already started (or finished) its auto-sync session. */
export const AUTO_SYNC_FLAG = 'zonadua.strava.autosync';

/** Value the marker holds while a session is in flight in this tab. */
export const AUTO_SYNC_IN_FLIGHT = 'syncing';

/** When auto-sync ran within this window, booting again does not re-run it. */
export const AUTO_SYNC_COOLDOWN_MS = 5 * 60_000;

/** Gate input — the boot-time facts, gathered by the caller. */
export interface AutoSyncGateInput {
  /** The stored `sync_state` row, if any. */
  sync: { accessToken?: string } | null | undefined;
  /** `navigator.onLine` at boot. */
  online: boolean;
  /**
   * This tab's marker value: `AUTO_SYNC_IN_FLIGHT` while a session runs, the epoch ms of
   * the last finished one, or `null` when this tab has never run one.
   */
  sessionFlag: string | null;
  /** Whether the earlier boot steps (schema, seed) finished. */
  booted: boolean;
  /** Clock, injectable for the cooldown test. */
  now: number;
}

export type AutoSyncGateReason =
  | 'not_booted'
  | 'not_connected'
  | 'offline'
  | 'already_syncing'
  | 'cooling_down';

export type AutoSyncGate = { ok: true } | { ok: false; reason: AutoSyncGateReason };

/**
 * Decide whether this boot may auto-sync. Pure — every rule visible in one place.
 */
export function autoSyncGate(input: AutoSyncGateInput): AutoSyncGate {
  if (!input.booted) return { ok: false, reason: 'not_booted' };
  if (!input.sync?.accessToken) return { ok: false, reason: 'not_connected' };
  if (!input.online) return { ok: false, reason: 'offline' };
  if (input.sessionFlag === AUTO_SYNC_IN_FLIGHT) return { ok: false, reason: 'already_syncing' };

  const ranAt = Number(input.sessionFlag);
  if (input.sessionFlag !== null && Number.isFinite(ranAt) && input.now - ranAt < AUTO_SYNC_COOLDOWN_MS) {
    return { ok: false, reason: 'cooling_down' };
  }
  return { ok: true };
}

/**
 * Run the boot auto-sync, gated.
 *
 * All effects flow through the same `runLiveSync` seam the Settings button uses — one
 * production sync path, no parallel pipeline. The sessionStorage marker makes the tab
 * honest about what it is doing: `syncing` while the session runs, then the boot time for
 * the cooldown. The sync loop itself decides success, throttling and cursor stamping, and
 * a failed session is silent here by design — the Settings chip and the untouched cursor
 * both still tell the truth, and the next boot retries.
 */
export async function runAutoSync(now = Date.now()): Promise<void> {
  const hasSession =
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(AUTO_SYNC_FLAG) : null;

  let sync: { accessToken?: string } | undefined;
  try {
    sync = await db.sync_state.get('strava');
  } catch {
    return; // schema not open yet — boot order guarantees the caller awaited it, but never race it
  }

  const gate = autoSyncGate({
    sync,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    sessionFlag: hasSession,
    booted: true,
    now
  });
  if (!gate.ok) return;

  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(AUTO_SYNC_FLAG, AUTO_SYNC_IN_FLIGHT);
    await runLiveSync();
  } catch {
    // A boot-time sync must never surface as an unhandled rejection — see the header.
  } finally {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(AUTO_SYNC_FLAG, String(now));
  }
}
