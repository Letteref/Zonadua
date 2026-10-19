import { expect, test, type Page } from '@playwright/test';

/**
 * PWA install E2E — both doors of `pwa-install.svelte.ts`, through the real UI.
 *
 * ## Why synthetic events
 *
 * Chromium only fires `beforeinstallprompt` when its own engagement heuristics decide to
 * (plus the mini-infobar it paints itself). Headless runs neither guarantee it nor let a
 * test press the native dialog, so each spec fires an event with a scriptable
 * `prompt()`/`userChoice` — the store cannot tell the difference, and the assertion
 * "`prompt()` fired exactly once" is the contract Chromium enforces anyway (one prompt
 * per captured event).
 *
 * ## The honest-fallback guarantee
 *
 * If Chrome *did* fire a real prompt, "no prompt captured" would become untestable, so
 * that spec blocks the event at the window before any app listener registers — the
 * situation a Safari or Firefox rider lives in permanently. The assertion is that
 * Settings shows manual instructions and *no* Install button: a button that pops
 * nothing is the exact failure this store exists to prevent.
 */

async function openApp(page: Page, hash = '#/'): Promise<void> {
  await page.goto(`/?r=${Date.now()}${hash}`);
  await page.locator('#app').waitFor({ timeout: 20_000 });
  // The main shell only renders past the first-run gate, and `initPwaInstall()` runs in
  // boot before any await — so the nav being visible means the store's listener is up.
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible({ timeout: 20_000 });
}

/** Arm a synthetic `beforeinstallprompt` whose prompt() the test can count. */
async function armPrompt(page: Page, outcome: 'accepted' | 'dismissed' = 'accepted'): Promise<void> {
  await page.evaluate((o) => {
    const w = window as unknown as { __installPrompts?: number };
    w.__installPrompts = 0;
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    e.prompt = () => {
      w.__installPrompts = (w.__installPrompts ?? 0) + 1;
      return Promise.resolve();
    };
    e.userChoice = Promise.resolve({ outcome: o });
    window.dispatchEvent(e);
  }, outcome);
}

/**
 * The store's pacing gate opens on a real gesture — the banner is not allowed to be
 * the first thing a rider meets. A key press is the least invasive one: no click
 * target to hit, no scroll to settle.
 */
async function interact(page: Page): Promise<void> {
  await page.keyboard.press('Tab');
}

const promptCount = (page: Page): Promise<number | undefined> =>
  page.evaluate(() => (window as unknown as { __installPrompts?: number }).__installPrompts);

test('the banner arms from a live prompt, fires the native prompt once, and reports the install', async ({ page }) => {
  await openApp(page);
  await armPrompt(page);
  await interact(page);

  const banner = page.getByRole('dialog', { name: 'Install Zonadua' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('no app store needed');

  await banner.getByRole('button', { name: 'Install', exact: true }).click();

  // exactly one native prompt: the store consumes the event on first fire
  await expect.poll(() => promptCount(page)).toBe(1);
  await expect(banner).toHaveCount(0); // accepted: standalone, nothing left to pitch
  await expect(page.getByText('Zonadua installed — open it from your home screen')).toBeVisible();
});

test('"Not now" hides the banner for good — a reload cannot bring it back', async ({ page }) => {
  await openApp(page);
  await armPrompt(page);
  await interact(page);
  const banner = page.getByRole('dialog', { name: 'Install Zonadua' });
  await expect(banner).toBeVisible();

  await banner.getByRole('button', { name: 'Not now' }).click();
  await expect(banner).toHaveCount(0);

  await page.reload();
  await page.locator('#app').waitFor({ timeout: 20_000 });
  await armPrompt(page); // the browser offers again; the rider's "no" still stands
  await interact(page); // pacing satisfied too — dismissal is the only reason it stays hidden
  await expect(banner).toHaveCount(0);
});

test('the banner waits for the rider\u2019s first gesture — no popup on an untouched screen', async ({ page }) => {
  await openApp(page);
  await armPrompt(page);

  const banner = page.getByRole('dialog', { name: 'Install Zonadua' });
  // a mis-gated banner would render within this beat — give it the chance to fail
  await page.waitForTimeout(300);
  await expect(banner).toHaveCount(0);

  await interact(page);
  await expect(banner).toBeVisible();
});

test('the banner lifts for a live toast and settles back into the nav slot', async ({ page }) => {
  // The error callback is the one boot path that raises a toast (6 s) — the exact
  // overlap window for two surfaces sharing one floating slot above the nav.
  await page.goto(`/?error=access_denied&r=${Date.now()}`);
  await page.locator('#app').waitFor({ timeout: 20_000 });
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('status')).toContainText('Strava authorization declined');

  await armPrompt(page);
  await interact(page);
  const banner = page.getByRole('dialog', { name: 'Install Zonadua' });
  await expect(banner).toBeVisible();

  // px from the viewport bottom; resting slot is 96, lifted over the toast is 150
  const bottom = (): Promise<number> =>
    banner.evaluate((el) => Math.round(window.innerHeight - el.getBoundingClientRect().bottom));
  await expect.poll(bottom).toBe(150); // clear of the toast at 96, never stacked

  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(bottom).toBe(96); // toast gone → tight gap over the nav again
});

test('the Settings row is the second door: it arms, installs, then admits it is installed', async ({ page }) => {
  await openApp(page, '#/settings');
  await armPrompt(page);

  const section = page.getByText('Install app', { exact: true });
  await expect(section).toBeVisible();
  const installBtn = section.locator('..').getByRole('button', { name: 'Install Zonadua' });
  await expect(installBtn).toBeVisible();

  // centre the row before tapping: the section sits at the very bottom of a long page,
  // so "already in view" can leave the button in the floating nav's strip
  await installBtn.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await installBtn.click();
  await expect.poll(() => promptCount(page)).toBe(1);

  // accepted → the section stops offering and states what is now true
  await expect(page.getByText('Running as the installed app')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Install Zonadua' })).toHaveCount(0);
});

test('with no prompt available the Settings row gives instructions, never a dead button', async ({ page }) => {
  // Block the event before any app code registers its listener — the permanent
  // situation on iOS Safari and desktop Firefox.
  await page.addInitScript(() => {
    window.addEventListener('beforeinstallprompt', (e) => e.stopImmediatePropagation());
  });
  await openApp(page, '#/settings');
  await armPrompt(page); // reaches a listener that never arrives

  await expect(page.getByText(/offers no one-tap install/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Install Zonadua' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Install Zonadua' })).toHaveCount(0);
});
