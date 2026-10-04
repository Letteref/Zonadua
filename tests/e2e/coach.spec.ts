import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Service workers are blocked for this suite.
 *
 * Zonadua is a PWA and the preview build installs a service worker, which then owns
 * network requests made by the page. `page.route` does not intercept service-worker
 * traffic, so with the worker active every stubbed provider call escaped the stub and
 * reached the real Gemini endpoint with a fake key — the suite failed with a live
 * `400 API key not valid` while `calls.calls` stayed at 0. Blocking the worker makes
 * the request originate from the page, where the route handler can see it.
 */
test.use({ serviceWorkers: 'block' });

/**
 * The AI coach gate, end to end.
 *
 * ## Why this suite exists
 *
 * The weekly review sends the rider's derived metrics to a model and then checks the
 * reply against the prompt it was given. That gate had no browser-level test at all:
 * `verify.ts` was covered by unit tests, but nothing proved the request actually leaves
 * the app, that a real Gemini-shaped response is parsed, or that a hallucinated number
 * reaches the rider as an error instead of as advice.
 *
 * That gap mattered more than usual here, because the response shape is the fragile
 * part. `generate()` reads `candidates[0].content.parts` for Gemini and
 * `choices[0].message.content` for the OpenAI-compatible providers — if either path is
 * wrong, the reply comes back **empty rather than throwing**, and an empty string
 * passes the number check trivially. A rider would see a blank review and a green
 * light. These tests stub the provider with exactly the documented response bodies, so
 * a shape regression fails here instead of in someone's browser.
 *
 * ## Why rides are seeded non-synthetic
 *
 * The production seed creates 24 demo rides, all `synthetic: true`, and Coach excludes
 * them from coaching — correctly, since demo data must not shape real advice. Left
 * alone, every case below would only ever assert the empty state. So the fixture writes
 * genuine rows inside the current week.
 */

async function openApp(page: Page, hash = '#/'): Promise<void> {
  await page.goto(`/?r=${Date.now()}${hash}`);
  await page.locator('#app').waitFor({ timeout: 20_000 });
}

/**
 * Give the app an API key and a week of real rides.
 *
 * Written as raw IndexedDB rows after first paint, following `raceFixture.ts`: Dexie's
 * `liveQuery` only observes mutations made on its own connection, so a row inserted
 * through a second connection would never reach the UI.
 *
 * The rides are dated relative to *now* rather than a fixed date, because
 * `buildWeekContext` only counts rows inside the Monday-to-today window. A hardcoded
 * timestamp would put the fixture outside the window the moment that week passed, and
 * the suite would fail with "No rides to review yet" for a reason that has nothing to
 * do with the gate.
 */
async function seedCoachData(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const dayMs = 86_400_000;
    const now = new Date();

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('zonadua');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    // two rides, both inside the current week, both real (not synthetic).
    // No `np` on purpose: `recompute.ts` regenerates a synthetic power trace for any row
    // that has metrics but no stream — `(!trace && (act.synthetic || act.np != null))` —
    // and then overwrites np/if/tss from that trace. The seeded TSS silently became 74 and
    // 42 instead of 88 and 61, so the prompt advertised a total the test never wrote and an
    // honest answer quoting the seeded figures was blocked as a hallucination. Leaving np
    // unset keeps the backfill off these rows entirely, so the fixture's numbers are the
    // numbers the rider would be shown.
    const rides = [
      { id: 'coach-ride-1', km: 40.2, sec: 4560, tss: 88, elev: 600 },
      { id: 'coach-ride-2', km: 28.5, sec: 3000, tss: 61, elev: 340 }
    ];
    // current METRICS_VERSION, so the backfill treats these rows as already carrying
    // current metrics rather than flagging them for recomputation
    const METRICS_VERSION = 1;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['settings', 'activities'], 'readwrite');
      tx.objectStore('settings').put({
        id: 'app',
        unit: 'metric',
        theme: 'light',
        lang: 'en',
        aiProvider: 'gemini',
        aiKey: 'AIzaTestKeyForLocalSuite000',
        weatherOn: true,
        updatedAt: Date.now()
      });
      for (const [i, r] of rides.entries()) {
        tx.objectStore('activities').put({
          id: r.id,
          // spread across the current week, newest first
          date: new Date(now.getTime() - i * dayMs).toISOString(),
          name: `Coach fixture ride ${i + 1}`,
          source: 'manual',
          distanceKm: r.km,
          movingSec: r.sec,
          elapsedSec: r.sec + 300,
          elevGainM: r.elev,
          avgPower: 168,
          tss: r.tss,
          avgHr: 142,
          maxHr: 171,
          kcal: 940,
          // the whole point: not synthetic, so coaching will read it
          synthetic: false,
          mVersion: METRICS_VERSION,
          updatedAt: Date.now()
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
}

/** The documented Gemini `generateContent` success body. */
function geminiBody(text: string): string {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 210, candidatesTokenCount: 64, totalTokenCount: 274 }
  });
}

/**
 * Stub the provider endpoint.
 *
 * Routing the real hostname rather than intercepting `fetch` in the page means the app
 * runs its actual `provider.ts` code path — URL, headers, request body, status handling
 * and response parsing all execute as they ship.
 */
async function stubProvider(
  context: BrowserContext,
  handler: (body: string) => { status: number; body: string; delayMs?: number }
): Promise<{ calls: number }> {
  const state = { calls: 0 };
  await context.route('**generativelanguage.googleapis.com/**', async (route) => {
    state.calls += 1;
    const reply = handler(route.request().postData() ?? '');
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    await route.fulfill({
      status: reply.status,
      contentType: 'application/json',
      body: reply.body
    });
  });
  return state;
}

test.describe('the coach only speaks in numbers it was given', () => {
  test('an answer that restates the prompt is shown to the rider', async ({ page, context }) => {
    await openApp(page, '#/coach');
    await seedCoachData(page);
    await page.reload();

    // Every figure below is printed in the prompt: distance_km 68.7, rides 2,
    // moving_time_min 126, tss 149. The rides are stored as 4560 and 3000 *seconds*,
    // which the prompt deliberately never shows — so an answer quoting those would be
    // talking about numbers the rider was never shown, and the gate blocks it.
    const honest =
      'You covered 68.7 km across 2 rides this week for 126 minutes of moving time.\n\n' +
      'That is 149 TSS in total, which is a steady week.';
    const calls = await stubProvider(context, () => ({ status: 200, body: geminiBody(honest) }));

    await page.getByRole('button', { name: /generate/i }).click();

    await expect(page.getByText(/68\.7 km across 2 rides/)).toBeVisible({ timeout: 15_000 });
    expect(calls.calls).toBe(1);

    // the rider is not left looking at a spinner, and no error is shown
    await expect(page.getByText(/invented numbers/)).toHaveCount(0);
    await expect(page.getByText(/Reading your week/)).toHaveCount(0);
  });

  test('a number that is in neither prompt nor context is blocked, not shown', async ({ page, context }) => {
    await openApp(page, '#/coach');
    await seedCoachData(page);
    await page.reload();

    // 315 W appears nowhere in the context — the week's figures are 68.7 km, 940 m,
    // 126 min and 149 TSS, and the prompt contains no power at all
    const invented =
      'You covered 68.7 km this week and held 315 W for most of it.\n\nStrong week overall.';
    await stubProvider(context, () => ({ status: 200, body: geminiBody(invented) }));

    await page.getByRole('button', { name: /generate/i }).click();

    await expect(page.getByText(/invented numbers/)).toBeVisible({ timeout: 15_000 });

    // the invented advice must not be on screen anywhere
    await expect(page.getByText(/held 315 W/)).toHaveCount(0);
    await expect(page.getByText(/Strong week overall/)).toHaveCount(0);
  });

  test('a rejected key is reported as a rejected key, not a hung button', async ({ page, context }) => {
    await openApp(page, '#/coach');
    await seedCoachData(page);
    await page.reload();

    await stubProvider(context, () => ({
      status: 400,
      body: JSON.stringify({ error: { message: 'API key not valid' } })
    }));

    await page.getByRole('button', { name: /generate/i }).click();

    await expect(page.getByText(/400/)).toBeVisible({ timeout: 15_000 });
    // the rider can try again rather than stare at a permanent spinner
    await expect(page.getByText(/Reading your week/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /generate/i })).toBeVisible();
  });

  // The abort in provider.ts is 45s, so this case cannot be observed inside the suite's
  // 45s default. It is the slowest test here by design rather than because the wait is
  // arbitrary — shortening the product timeout to make a test quick would be tuning the
  // rider's failure mode to suit the suite.
  test.setTimeout(120_000);

  test('a provider that never answers is cut off instead of spinning forever', async ({ page, context }) => {
    await openApp(page, '#/coach');
    await seedCoachData(page);
    await page.reload();

    // longer than the 45s abort in provider.ts, so the timeout is what ends the request
    await stubProvider(context, () => ({ status: 200, body: geminiBody('never delivered'), delayMs: 90_000 }));

    await page.getByRole('button', { name: /generate/i }).click();
    await expect(page.getByText(/Reading your week/)).toBeVisible();

    await expect(page.getByText(/did not answer in 45 seconds/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Reading your week/)).toHaveCount(0);
  });
});