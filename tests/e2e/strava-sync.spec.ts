import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Strava sync E2E — the rider-visible half of the sync loop, against the real app.
 *
 * Only Strava's API is simulated (`page.route`): the loop, the Dexie writes, the cursor
 * stamping and the Settings messaging are the shipped code. The connected state is seeded
 * the way the connect flow leaves it — a `sync_state` row with tokens, no cursor.
 *
 * ## Why every response carries CORS headers here
 *
 * The browser calls `www.strava.com` directly, so a real `Authorization` header makes the
 * request preflighted. A fulfilled response without the CORS headers is rejected by the
 * browser before the app ever sees a status code — and, more quietly, `X-RateLimit-*` is
 * unreadable unless the server exposes it, which would leave the 80% guard silently inert.
 * Strava exposes them in production; the fake must as well, or the test would pass for the
 * wrong reason.
 */

const TOKEN = {
  access_token: 'at-sync',
  refresh_token: 'rt-sync',
  expires_at: 4_102_444_800,
  token_type: 'Bearer',
  athlete: { id: 42 }
};

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
  // without this the browser hides the budget the guard is built on
  'access-control-expose-headers': 'x-ratelimit-limit,x-ratelimit-usage,x-readratelimit-limit,x-readratelimit-usage'
};

const RATE_HEADERS: Record<string, string> = { 'x-ratelimit-usage': '10,100', 'x-ratelimit-limit': '100,1000' };

/** A ride two days back, so it lands inside whatever window the Rides page opens on. */
const recentStart = (): string => new Date(Date.now() - 2 * 86_400_000).toISOString();

function summary(id: number, name: string): Record<string, unknown> {
  return {
    id,
    name,
    start_date: recentStart(),
    distance: 42_000,
    moving_time: 5_400,
    elapsed_time: 6_000,
    total_elevation_gain: 320,
    average_watts: 180,
    weighted_average_watts: 210,
    kilojoules: 950,
    type: 'Ride'
  };
}

const STREAMS = [
  { type: 'time', data: [0, 1, 2] },
  { type: 'watts', data: [150, 220, 180] }
];

interface FakeResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Answer a (possibly preflighted) cross-origin Strava call the way Strava would. */
async function stravaFulfill(route: Route, res: FakeResponse): Promise<void> {
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: CORS });
    return;
  }
  await route.fulfill({
    status: res.status ?? 200,
    contentType: 'application/json',
    headers: { ...CORS, ...(res.headers ?? {}) },
    body: JSON.stringify(res.body ?? [])
  });
}

const syncNote = (page: Page) => page.getByTestId('strava-sync-note');

/**
 * Seed the connected state: a `sync_state` row with tokens, as the connect flow leaves it.
 * Same convention as the toast suite: boot the app once (it owns the schema), write the
 * row through it, then let the caller reload so the app reads the seeded state.
 */
async function seedConnected(page: Page): Promise<void> {
  await page.goto(`/?r=${Date.now()}#/`);
  await page.locator('#app').waitFor({ timeout: 20_000 });
  await page.evaluate((tok) => {
    const done = new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('zonadua');
      open.onsuccess = () => {
        const d = open.result;
        try {
          const tx = d.transaction('sync_state', 'readwrite');
          tx.objectStore('sync_state').put({
            id: 'strava',
            accessToken: tok.access_token,
            refreshToken: tok.refresh_token,
            expiresAt: tok.expires_at,
            athleteId: tok.athlete.id,
            updatedAt: Date.now()
          });
          tx.oncomplete = () => {
            d.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        } catch (err) {
          reject(err);
        }
      };
      open.onerror = () => reject(open.error);
    });
    return done;
  }, TOKEN);
}

async function openSettings(page: Page): Promise<void> {
  await page.goto(`/?r=${Date.now()}#/settings`);
  await page.locator('#app').waitFor({ timeout: 20_000 });
}

test.describe('strava sync', () => {
  test('Sync now pulls rides that appear in Rides, and says so', async ({ page }) => {
    await seedConnected(page);

    await page.route('**/athlete/activities**', (route) =>
      stravaFulfill(route, { body: [summary(9001, 'Morning Tempo')] , headers: RATE_HEADERS })
    );
    await page.route('**/activities/9001/streams**', (route) =>
      stravaFulfill(route, { body: STREAMS, headers: RATE_HEADERS })
    );

    await openSettings(page);
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(syncNote(page)).toContainText(/pulled 1 ride/i);

    // the ride exists in the app's own database now, with strava provenance
    await page.goto(`/?r=${Date.now()}#/rides`);
    await page.locator('#app').waitFor({ timeout: 20_000 });
    await expect(page.getByText('Morning Tempo')).toBeVisible({ timeout: 10_000 });
  });

  test('the 80% rate-limit guard stops the sync and says when it resumes', async ({ page }) => {
    await seedConnected(page);

    await page.route('**/athlete/activities**', (route) =>
      stravaFulfill(route, {
        body: [summary(9002, 'Guard Ride')],
        headers: { 'x-ratelimit-usage': '85,100', 'x-ratelimit-limit': '100,1000' }
      })
    );

    await openSettings(page);
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(syncNote(page)).toContainText(/rate-limit guard \(80%/i);
    await expect(syncNote(page)).toContainText(/resumes in ~\d+ min/i);

    // nothing was stored from the guarded session
    await page.goto(`/?r=${Date.now()}#/rides`);
    await page.locator('#app').waitFor({ timeout: 20_000 });
    await expect(page.getByText('Guard Ride')).toHaveCount(0);
  });

  test('a rejected authorization is reported as reconnect guidance', async ({ page }) => {
    await seedConnected(page);

    await page.route('**/athlete/activities**', (route) =>
      stravaFulfill(route, { status: 401, body: { message: 'Unauthorized' } })
    );
    // the refresh attempt fails too — no fresh token, so the loop gives up honestly
    await page.route('**/api/strava/token', (route) =>
      stravaFulfill(route, { status: 400, body: { message: 'Bad Request' } })
    );

    await openSettings(page);
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(syncNote(page)).toContainText(/rejected the saved authorization/i);
  });
});
