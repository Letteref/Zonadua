/**
 * E2E fixture data — the route and race the cockpit tests ride.
 *
 * ## Why this seeds IndexedDB instead of using `seed.ts`
 *
 * The production seed fills athlete, bikes, components, activities and streams — but **not
 * `routes` or `races`**. The cockpit's entire value depends on a solved route profile, so a
 * suite relying on the seed would only ever exercise the "No GPX" empty state. Rather than
 * widen the production seed (which would put a fake route in every real user's first
 * launch), the tests seed exactly the rows they need and nothing else.
 *
 * The profile is a genuine sinusoid with real climb, not a flat line: `powerForSpeed` judges
 * the *gradient*, and on a flat route every feasibility answer is trivially "sustainable".
 */

import type { Page } from '@playwright/test';

/** Race the whole suite rides. Mirrors the defaults the cockpit itself configures. */
export const RACE = {
  id: 'race-e2e',
  name: 'E2E Test Race',
  routeId: 'route-e2e',
  distanceKm: 200,
  elevGainM: 2200,
  /** 05:30 roll-out, minutes past midnight */
  startMin: 330,
  /** 13 h hard limit after the gun */
  cutoffMin: 780,
  checkpoints: [{ km: 120, cutoffMin: 570, label: 'CP2 Payakumah' }]
} as const;

/** 10:00 WIB — 4h30 into an 05:30 start. */
export const FROZEN_MORNING = '2026-10-02T10:00:00+07:00';

/**
 * Write the fixture rows into the app's own database.
 *
 * The stores are **not** created here: they are owned by Dexie's schema in `db.ts`, and
 * creating them with a different index set here would make the app throw `SchemaError` on
 * its next open. The app therefore always navigates first, and this only inserts rows.
 */
async function seedFixture(page: Page): Promise<void> {
  await page.evaluate(async (race) => {
    // 200 km of rolling terrain: a long climb, a descent and a second ramp, sampled every
    // 100 m so the solver sees real gradients instead of one averaged slope.
    const points: Array<[number, number]> = [];
    for (let km = 0; km <= 200; km += 0.1) {
      const grade =
        6 * Math.sin((km / 200) * Math.PI * 2) + 2.5 * Math.sin((km / 47) * Math.PI * 2);
      points.push([Number(km.toFixed(2)), Math.round(800 + km * 11 + (grade / 100) * 100)]);
    }

    // Compress with the same deflate-raw stream the app writes, so the bytes round-trip
    // through `inflateJson` rather than relying on the plain-JSON fallback path.
    const json = JSON.stringify(points);
    const bytes = new Uint8Array(
      await new Response(
        new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))
      ).arrayBuffer()
    );

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('gowslab');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['routes', 'races'], 'readwrite');
        tx.objectStore('routes').put({
          id: race.routeId,
          name: 'E2E Route',
          distanceKm: race.distanceKm,
          elevGainM: race.elevGainM,
          pointsCompressed: bytes,
          pointCount: points.length,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
        tx.objectStore('races').put({
          id: race.id,
          routeId: race.routeId,
          name: race.name,
          startTime: new Date(new Date().setHours(0, 0, 0, 0) + race.startMin * 60000).toISOString(),
          cutoffFinishMin: race.cutoffMin,
          checkpoints: race.checkpoints,
          planJson: JSON.stringify({ ifTarget: 0.7, cargoKg: 0, stopsMin: 30, bikeId: null }),
          status: 'planned',
          updatedAt: Date.now()
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, RACE);
}

/**
 * Load the cockpit with the fixture in place and ready to be started.
 *
 * The clock is installed **before** navigation on purpose: the cockpit reads `Date.now()`
 * when it initialises and rebuilds the start time as "today at the configured roll-out", so
 * a clock installed after load would be ignored and every assertion below would quietly
 * measure wall-clock time instead. The `?r=` query forces a fresh document, because the
 * router is hash-based and a hash swap would keep stale module state.
 */
export async function openRaceCockpit(page: Page, iso: string = FROZEN_MORNING): Promise<void> {
  await page.clock.install({ time: new Date(iso) });
  await page.goto(`/?r=${Date.now()}#/race`);
  // first paint creates the schema; wait for the app shell before touching the stores
  await page.locator('#app').waitFor({ timeout: 15_000 });
  await seedFixture(page);
  await page.reload();
  await page.getByText('RACE SETUP').waitFor({ timeout: 15_000 });
}

/** Press "Start race mode" and wait for the live cockpit hero. */
export async function startRace(page: Page): Promise<void> {
  await page.getByRole('button', { name: /start race mode/i }).click();
  await page.getByText('BUFFER VS CUT-OFF').waitFor({ timeout: 15_000 });
}