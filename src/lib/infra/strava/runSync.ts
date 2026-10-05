/**
 * Production wiring for the sync loop — the thin seam between `runStravaSync`'s injected
 * dependencies and the real app state.
 *
 * Everything here is I/O that the unit tests fake: the live Dexie row, the Pages Function
 * refresh route, and the browser clock. Keeping it in a few obvious lines keeps the loop
 * itself testable without a browser.
 */

import { db } from '../../data/db';
import { parseTokenResponse } from './oauth';
import { runStravaSync, type SyncDeps, type SyncResult } from './syncLoop';

/**
 * Build the dependency set against the real database and the deployed Function, then run
 * one sync session. Returns `not_connected` when no token is stored — the caller renders
 * that as the Connect button, not as an error.
 *
 * The row is read once up front and held in a ref that the refresh path updates, so
 * `token()`/`cursor()`/`save()` all answer from one consistent view of `sync_state` even
 * when a refresh lands mid-session.
 */
export async function runLiveSync(): Promise<SyncResult | { ok: false; reason: 'not_connected' }> {
  const stored = await db.sync_state.get('strava');
  if (!stored?.accessToken) return { ok: false, reason: 'not_connected' };

  // One mutable view of the row for the whole session.
  const ref = { current: stored };

  const deps: SyncDeps = {
    token: () => ref.current.accessToken,
    cursor: () => ref.current.cursor ?? 0,
    save: async (patch) => {
      const next = {
        ...ref.current,
        cursor: patch.cursor ?? ref.current.cursor,
        lastSyncAt: patch.lastSyncAt,
        updatedAt: Date.now()
      };
      ref.current = next;
      await db.sync_state.put(next);
    },
    refresh: async (refreshToken) => {
      try {
        const res = await fetch('/api/strava/token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        });
        if (!res.ok) return null;
        const parsed = parseTokenResponse(await res.json());
        if (!parsed) return null;
        // Keep the stored refresh token (Strava omits it on refresh) and update the view.
        ref.current = { ...ref.current, accessToken: parsed.accessToken, expiresAt: parsed.expiresAt };
        await db.sync_state.put(ref.current);
        return { accessToken: parsed.accessToken, expiresAt: parsed.expiresAt };
      } catch {
        return null;
      }
    },
    // Wrapped, not assigned: `deps.fetchFn(...)` would call the global `fetch` with `this`
    // bound to the deps object, and the Fetch API throws "Illegal invocation" for that.
    // The unit tests pass their own stub, which is why only the real browser catches it.
    fetchFn: (input, init) => fetch(input, init),
    now: Date.now
  };

  return runStravaSync(deps);
}
