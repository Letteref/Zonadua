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
import { seedDashboardFixture } from './dashboardFixture';

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

/**
 * Races that were already finished before the cockpit opened.
 *
 * Two of them, deliberately unequal. `withBaseline` carries the estimate the rider was
 * given alongside the time it took, so it can be compared. `withoutBaseline` carries only
 * the actual — which is exactly what every race finished before this feature existed looks
 * like. Seeding both means the card's honest fallback is exercised by real stored data
 * rather than by a value poked in at runtime.
 *
 * They are seeded as raw IndexedDB rows before the app reads them, rather than written
 * through Dexie mid-test: liveQuery only observes mutations made on its own connection, so
 * a raw write from a second connection would silently never reach the UI.
 */
export const PAST_RACES = [
  {
    id: 'race-past-measured',
    name: 'Bukittinggi 150',
    startMin: 5 * 60 + 30,
    /** 7h19m promised */
    plannedFinishMin: 330 + 439,
    /** took 7h45m: 26 min slower than the plan */
    actualFinishMin: 465
  },
  {
    id: 'race-past-unmeasured',
    name: 'Karo Loop (old entry)',
    startMin: 5 * 60 + 30,
    plannedFinishMin: null,
    actualFinishMin: 400
  }
] as const;

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
  await page.evaluate(async ({ PAST, ...race }) => {
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
      const req = indexedDB.open('zonadua');
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
        for (const past of PAST) {
          const plan: Record<string, unknown> = { ifTarget: 0.7, cargoKg: 0, stopsMin: 30 };
          if (past.plannedFinishMin != null) plan.plannedFinishMin = past.plannedFinishMin;
          plan.actualFinishMin = past.actualFinishMin;
          tx.objectStore('races').put({
            id: past.id,
            routeId: race.routeId,
            name: past.name,
            startTime: new Date(
              new Date().setHours(0, 0, 0, 0) + past.startMin * 60000
            ).toISOString(),
            cutoffFinishMin: race.cutoffMin,
            checkpoints: [],
            planJson: JSON.stringify(plan),
            status: 'finished',
            updatedAt: Date.now() - (PAST.length - PAST.indexOf(past)) * 86_400_000
          });
        }
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
  }, { ...RACE, PAST: PAST_RACES });
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
export async function openRaceCockpit(
  page: Page,
  iso: string = FROZEN_MORNING,
  opts: { realClock?: boolean } = {}
): Promise<void> {
  // `realClock` exists for the latency measurement only: Playwright's clock also stubs
  // `performance.now`, so a frozen clock would report a repaint that never happened. Timing
  // has to run on the real thing.
  if (!opts.realClock) await page.clock.install({ time: new Date(iso) });
  await page.goto(`/?r=${Date.now()}#/race`);
  // first paint creates the schema; wait for the app shell before touching the stores
  await page.locator('#app').waitFor({ timeout: 15_000 });
  // The cockpit solves its plan against the rider's weight and FTP, which production no
  // longer seeds. `seedDashboardFixture` supplies athlete, weight, FTP and a bike — the
  // same rows the app used to get from its demo seeder. It runs before `seedFixture` so
  // both land before the single reload below.
  await seedDashboardFixture(page);
  await seedFixture(page);
  await page.reload();
  await page.getByText('RACE SETUP').waitFor({ timeout: 15_000 });
}

/** Press "Start race mode" and wait for the live cockpit hero. */
export async function startRace(page: Page): Promise<void> {
  await page.getByRole('button', { name: /start race mode/i }).click();
  await page.getByText('BUFFER VS CUT-OFF').waitFor({ timeout: 15_000 });
}