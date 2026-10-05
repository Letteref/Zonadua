import type { Page } from '@playwright/test';

/**
 * Dashboard fixture — the rows the hero tests need, seeded explicitly.
 *
 * ## Why this exists
 *
 * Production no longer carries demo content: a first-launch rider sees an empty training
 * log, not 24 rides named after someone else's bike. The suite runs against a production
 * build, so the tests that assert dashboard layout with real content seed exactly the
 * rows they need, the same way `raceFixture` and the coach fixture already do.
 *
 * This replaces the old `waitForSeed`, which polled for the *app's own seeder* to fill
 * these tables. Waiting on the seeder made the tests depend on a behaviour the product
 * no longer has — the fixture makes that dependency explicit and under the test's control.
 *
 * ## What it seeds, and why that shape
 *
 * Two weeks of rides with a rising TSS gives the PMC a window to walk, so CTL/ATL/TSB are
 * real numbers rather than the empty-window "NO DATA" state. Rides carry `np`, so the
 * hero's power figures have something to show. Dates are relative to *now*, because the
 * PMC window is anchored on today — hardcoding them would silently push every ride
 * outside the window and turn these tests into empty-state tests.
 *
 * Written as raw IndexedDB rows after first paint, following `raceFixture.ts`: Dexie's
 * `liveQuery` only observes mutations made on its own connection, so a row inserted
 * through a second connection would never reach the UI.
 */
export async function seedDashboardFixture(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('zonadua');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const day = 86_400_000;
    const now = Date.now();

    // Seven rides over two weeks, building TSS, alternating long/short.
    // Deliberately NOT eight: the rides list renders `recentActivities`, which is
    // `.limit(8)` newest-first. The TCX-import test seeds this fixture and then imports a
    // ride dated 15 days back — an eighth fixture row would push that import out of the
    // newest-8 window, and the test would fail on a list that never shows a ride the
    // database actually holds.
    const rides = [
      { ago: 1, km: 42.3, sec: 5400, tss: 88, np: 210, elev: 600 },
      { ago: 3, km: 24.1, sec: 3000, tss: 44, np: 188, elev: 210 },
      { ago: 5, km: 51.0, sec: 6600, tss: 104, np: 224, elev: 830 },
      { ago: 7, km: 18.7, sec: 2400, tss: 31, np: 172, elev: 140 },
      { ago: 8, km: 44.8, sec: 5700, tss: 92, np: 214, elev: 660 },
      { ago: 10, km: 22.5, sec: 2880, tss: 40, np: 182, elev: 190 },
      { ago: 12, km: 47.9, sec: 6120, tss: 96, np: 218, elev: 710 }
    ];

    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(
          ['athlete', 'settings', 'bikes', 'weight_log', 'ftp_history', 'activities'],
          'readwrite'
        );

        tx.objectStore('athlete').put({
          id: 'me',
          name: 'E2E Rider',
          sex: 'm',
          birthDate: '1991-05-14',
          heightCm: 178,
          restingHr: 48,
          maxHr: 186,
          updatedAt: now
        });

        tx.objectStore('settings').put({
          id: 'app',
          unit: 'metric',
          theme: 'light',
          lang: 'en',
          weatherOn: true,
          updatedAt: now
        });

        tx.objectStore('bikes').put({
          id: 'bike-e2e',
          name: 'E2E Road',
          type: 'road',
          weightKg: 9.4,
          crr: 0.0045,
          cda: 0.32,
          odometerKm: 1200,
          active: true,
          updatedAt: now
        });

        tx.objectStore('weight_log').put({
          id: 'w-e2e',
          date: new Date(now - day).toISOString().slice(0, 10),
          // 68.2 kg and 275 W are the *tail* of the old demo trend, not arbitrary picks:
          // the routes-hero layout test asserts the strip survives its widest realistic
          // figure, and that figure was computed from exactly these inputs. Changing them
          // here would silently weaken that test by shrinking the number it guards.
          kg: 68.2,
          updatedAt: now
        });

        tx.objectStore('ftp_history').put({
          id: 'ftp-e2e',
          date: new Date(now - 30 * day).toISOString().slice(0, 10),
          ftp: 275,
          updatedAt: now
        });

        for (const [i, r] of rides.entries()) {
          tx.objectStore('activities').put({
            id: `dash-ride-${i}`,
            date: new Date(now - r.ago * day).toISOString(),
            name: `E2E ride ${i + 1}`,
            source: 'manual',
            bikeId: 'bike-e2e',
            distanceKm: r.km,
            movingSec: r.sec,
            elapsedSec: r.sec + 300,
            elevGainM: r.elev,
            avgPower: Math.round(r.np * 0.86),
            np: r.np,
            if: Math.round((r.np / 265) * 100) / 100,
            tss: r.tss,
            avgHr: 142,
            maxHr: 168,
            kcal: Math.round((r.sec / 3600) * 620),
            synthetic: false,
            mVersion: 1,
            updatedAt: now
          });
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
}
