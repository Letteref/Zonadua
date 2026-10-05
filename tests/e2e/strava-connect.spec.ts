import { expect, test, type Page } from '@playwright/test';

/**
 * Strava connect E2E — the redirect half of the OAuth round trip, against the real app.
 *
 * ## What is simulated and what is not
 *
 * Only Strava's own pages are outside the test's reach, so the suite simulates exactly
 * those: the redirect back to `/` (query string before the hash, as Strava sends it) and —
 * via `page.route` — the `/api/strava/token` exchange, which in production is our Pages
 * Function forwarding to Strava. Everything else is the shipped app: the parked session, the
 * state check, the Dexie write, the connected chip.
 *
 * The production preview build has no `VITE_STRAVA_CLIENT_ID`, so the button's honest
 * refusal ("not configured") is testable as-is, and the callback tests park their own
 * session the way `startStravaConnect` would have.
 */

const OAUTH_SESSION_KEY = 'strava_oauth';
const VERIFIER = 'v'.repeat(43);

async function openApp(page: Page, hash = '#/'): Promise<void> {
  await page.goto(`/?r=${Date.now()}${hash}`);
  await page.locator('#app').waitFor({ timeout: 20_000 });
}

function parkSession(page: Page, state: string): void {
  void page.addInitScript(
    ({ key, verifier, state }) => {
      sessionStorage.setItem(key, JSON.stringify({ verifier, state, redirectUri: window.location.origin + '/' }));
    },
    { key: OAUTH_SESSION_KEY, verifier: VERIFIER, state }
  );
}

const TOKEN_BODY = {
  access_token: 'at-e2e',
  refresh_token: 'rt-e2e',
  expires_at: 4_102_444_800,
  token_type: 'Bearer',
  athlete: { id: 42 }
};

test.describe('strava connect', () => {
  test('the Settings section offers Connect and refuses honestly without a client id', async ({ page }) => {
    await openApp(page, '#/settings');

    const connect = page.getByRole('button', { name: 'Connect Strava' });
    await expect(connect).toBeVisible();

    await connect.click();
    await expect(page.getByRole('status')).toContainText('Strava is not configured on this deployment yet');
    // an unconfigured deployment must not send the rider to a broken authorize page
    expect(page.url()).toContain('#/settings');
  });

  test('a Strava redirect exchanges the code, stores the token and shows connected', async ({ page }) => {
    const exchanges: Array<Record<string, unknown>> = [];
    await page.route('**/api/strava/token', async (route) => {
      exchanges.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TOKEN_BODY) });
    });
    parkSession(page, 'st-e2e-ok');

    // the redirect as Strava sends it: query string before the hash, on the origin root
    await page.goto(`/?code=e2e-code&state=st-e2e-ok&r=${Date.now()}`);
    await page.locator('#app').waitFor({ timeout: 20_000 });

    await expect(page.getByRole('status')).toContainText('Strava connected');
    // the one-time code must not linger in the address bar
    expect(page.url()).not.toContain('code=');

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].grant_type).toBe('authorization_code');
    expect(exchanges[0].code).toBe('e2e-code');
    expect(exchanges[0].code_verifier).toBe(VERIFIER);

    // the credential survived into sync_state — Settings now shows the connected state
    await openApp(page, '#/settings');
    await expect(page.getByRole('button', { name: 'Disconnect Strava' })).toBeVisible();
    await expect(page.getByText('Connected', { exact: false }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Disconnect Strava' }).click();
    await expect(page.getByRole('status')).toContainText('Strava disconnected');
    await expect(page.getByRole('button', { name: 'Connect Strava' })).toBeVisible();
  });

  test('a forged state aborts before the code is spent', async ({ page }) => {
    let exchanges = 0;
    await page.route('**/api/strava/token', async (route) => {
      exchanges += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TOKEN_BODY) });
    });
    parkSession(page, 'st-real');

    await page.goto(`/?code=e2e-code&state=forged&r=${Date.now()}`);
    await page.locator('#app').waitFor({ timeout: 20_000 });

    await expect(page.getByRole('status')).toContainText('could not be verified');
    expect(exchanges).toBe(0);
    // the parked pair is dropped: a replayed URL cannot succeed either
    expect(await page.evaluate((key) => sessionStorage.getItem(key), OAUTH_SESSION_KEY)).toBeNull();
  });

  test('a declined authorization is reported in words, not thrown', async ({ page }) => {
    await page.goto(`/?error=access_denied&r=${Date.now()}`);
    await page.locator('#app').waitFor({ timeout: 20_000 });

    await expect(page.getByRole('status')).toContainText('Strava authorization declined');
  });
});
