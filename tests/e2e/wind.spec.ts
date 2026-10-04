import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

test.use({ serviceWorkers: 'block' });

/**
 * Weather-aware estimator (ROADMAP M5 DoD line 4).
 *
 * The requirement is that the estimator *adjusts its time* under a strong headwind, from a
 * mocked Open-Meteo fixture. The whole point is that the plan on screen is the corrected
 * one — so this asserts on the ETA the rider reads, not on a helper's return value.
 *
 * The provider is stubbed at the network boundary rather than the weather module mocked, so
 * the real `provider.ts` → `parseHourlyWind` → `correctForWind` → `buildPlan` chain runs as
 * it ships. A mock at the module boundary would prove only that the mock was called.
 */

/** An Open-Meteo body with `speed` km/h from `dir` degrees, for `hours` consecutive hours. */
function openMeteo(speed: number, dir: number, hours = 24): string {
  return JSON.stringify({
    hourly: {
      time: Array.from({ length: hours }, (_, i) => `2026-10-04T${String(i).padStart(2, '0')}:00`),
      wind_speed_10m: Array.from({ length: hours }, () => speed),
      wind_direction_10m: Array.from({ length: hours }, () => dir)
    }
  });
}

async function stubWeather(context: BrowserContext, body: string, status = 200): Promise<void> {
  await context.route('**api.open-meteo.com/**', async (route) => {
    await route.fulfill({ status, contentType: 'application/json', body });
  });
}

/**
 * The estimated finish the hero card is showing.
 *
 * Anchored to the "Est finish" tile rather than a bare time, because a bare time matches
 * half a dozen numbers on the page. This is the figure the DoD says must change.
 */
async function etaText(page: Page): Promise<string> {
  const tile = page.getByText('Est finish').locator('..');
  await expect(tile).toBeVisible({ timeout: 15_000 });
  return (await tile.innerText()).trim();
}

/**
 * Minutes from the hero tile's finish text.
 *
 * `durationOf` prints `54m` under an hour and `1h 05m` over it, so the hours group is
 * optional. An earlier version of this required it, which silently rejected every
 * sub-hour estimate on this deliberately short fixture — a test that cannot fail for the
 * reason it exists.
 */
function finishMinutes(text: string): number {
  const withHours = text.match(/(\d+)h\s*(\d+)m/);
  if (withHours) return Number(withHours[1]) * 60 + Number(withHours[2]);
  const minutesOnly = text.match(/(\d+)m/);
  return minutesOnly ? Number(minutesOnly[1]) : NaN;
}

const GPX = fileURLToPath(new URL('./fixtures/route.gpx', import.meta.url));

/**
 * Import the GPX so the route has real coordinates and a real bearing.
 *
 * The route estimator compresses a track down to `[km, alt]` pairs, discarding lat/lng, so
 * the only moment coordinates exist is during import — and the forecast refuses to run
 * without them. That refusal is deliberate; here the point is to get a bearing so the
 * headwind arithmetic is exercised on a real direction of travel.
 */
async function importRoute(page: Page): Promise<void> {
  await page.locator('input[type="file"]').first().setInputFiles(GPX);
  await expect(page.getByRole('button', { name: 'Load', exact: true })).toBeVisible({ timeout: 20_000 });
}

/** Open the routes screen with the GPX already imported. */
async function openWithRoute(page: Page): Promise<void> {
  await page.goto(`/?r=${Date.now()}#/routes`);
  await page.locator('#app').waitFor({ timeout: 20_000 });
  await importRoute(page);
}

test.describe('weather-aware estimator', () => {
  test('a strong headwind from the fixture stretches the estimated time', async ({ page, context }) => {
    await openWithRoute(page);

    // before any forecast: the imported route's still-air solve
    const before = await etaText(page);

    // A 45 km/h wind. The GPX runs roughly east, so this is read against the rider's own
    // bearing — whichever sign it works out to, the point is the ETA must move.
    await stubWeather(context, openMeteo(45, 90));
    await page.getByRole('button', { name: 'Load', exact: true }).click();

    await expect(page.getByText(/ROUTE BEARING/)).toBeVisible({ timeout: 15_000 });

    const after = await etaText(page);
    expect(after).not.toEqual(before);

    // a headwind on an eastbound route must make the plan *longer*, not shorter
    expect(finishMinutes(after)).toBeGreaterThan(finishMinutes(before));

    // and the plan must say where the peak is, so the rider can budget bottles for it
    await expect(page.getByText(/PEAK/)).toBeVisible();
  });

  test('a tailwind shortens the plan, which is what proves the sign is right', async ({ page, context }) => {
    await openWithRoute(page);
    const before = await etaText(page);

    // due west on an eastbound route — a pure tailwind
    await stubWeather(context, openMeteo(45, 270));
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await expect(page.getByText(/ROUTE BEARING/)).toBeVisible({ timeout: 15_000 });

    const after = await etaText(page);

    // The plan must get *faster*, not slower: `requiredPower` computes air speed as
    // v + headwind, so a negative headwind removes drag and the solver legitimately
    // if the sign were inverted everywhere, so this asserts the direction.
    expect(after).not.toEqual(before);
    expect(finishMinutes(after)).toBeLessThan(finishMinutes(before));
  });

  test('a failed forecast leaves the plan alone and says the wind is unknown', async ({ page, context }) => {
    await openWithRoute(page);
    const before = await etaText(page);

    await stubWeather(context, JSON.stringify({ error: 'unavailable' }), 500);
    await page.getByRole('button', { name: 'Load', exact: true }).click();

    // the rider is told the plan is windless, not calm — those are different claims
    await expect(page.getByText(/windless, not calm/i)).toBeVisible({ timeout: 15_000 });
    expect(await etaText(page)).toBe(before);
  });

  test('a partial forecast is refused rather than read as calm hours', async ({ page, context }) => {
    await openWithRoute(page);

    // a hole in the series: accepting it would understate the headwind around the gap
    const body = JSON.stringify({
      hourly: {
        time: ['2026-10-04T00:00', '2026-10-04T01:00', '2026-10-04T02:00'],
        wind_speed_10m: [45, null, 45],
        wind_direction_10m: [90, 90, 90]
      }
    });
    await stubWeather(context, body);
    await page.getByRole('button', { name: 'Load', exact: true }).click();

    await expect(page.getByText(/No forecast available/i)).toBeVisible({ timeout: 15_000 });
  });
});
