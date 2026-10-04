import { expect, test, type Page } from '@playwright/test';

/**
 * Failed-write E2E — the rider-visible half of the local-first promise.
 *
 * ## Why this suite exists
 *
 * Every Dexie write in Zonadua is local-first: a ride, a zone change or a race checkpoint
 * exists only in this browser. Until now 27 `catch` blocks logged to the console and
 * returned, so a write that failed left the screen looking exactly like a write that
 * succeeded — `saveComponent` closed its sheet either way, and `finishRace` tore down the
 * live session. Two of the three local `showToast` copies also painted failures with the
 * green confirmation glyph.
 *
 * ## How the failure is forced
 *
 * The failure is injected at `IDBDatabase.prototype.transaction`, not mocked into the
 * component. Dexie owns its own connection and the test never reaches it, so breaking the
 * storage layer underneath is the only way to exercise the real rejection path: the code
 * under test is exactly what ships, catching exactly what IndexedDB throws in the field
 * when a device runs out of quota.
 */

async function openApp(page: Page, hash = '#/'): Promise<void> {
  await page.goto(`/?r=${Date.now()}${hash}`);
  await page.locator('#app').waitFor({ timeout: 20_000 });
}

/**
 * Make every `put`/`add` on `table` fail, the way a quota-exhausted store does.
 *
 * ## Why the object store and not the database
 *
 * Dexie binds `IDBDatabase.transaction` once, when the connection opens (`dexie.js`
 * `createDBCore` → `transaction: db.transaction.bind(db)`), so a prototype patch on the
 * database is captured before the test ever runs and never sees a write. The per-record
 * calls go through `store[type](…)` resolved on every call, which is why the object store
 * is the seam that actually reaches a live write.
 *
 * ## Why after first paint
 *
 * The seed writes components too, so breaking the store at boot would leave the rider with
 * no bikes and the test would assert against an empty screen.
 */
async function breakWrites(page: Page, table: string): Promise<void> {
  await page.evaluate((name) => {
    const store = IDBObjectStore.prototype as IDBObjectStore & { __zonaduaBroken?: Set<string> };
    if (!store.__zonaduaBroken) {
      store.__zonaduaBroken = new Set<string>();
      for (const method of ['put', 'add'] as const) {
        const original = store[method];
        store[method] = function wrapped(this: IDBObjectStore, ...args: unknown[]) {
          if (store.__zonaduaBroken!.has(this.name)) {
            const error = new DOMException('injected failure', 'QuotaExceededError');
            // a request-shaped error the caller can still attach to a transaction
            Object.defineProperty(error, 'target', { value: this });
            throw error;
          }
          return (original as (...a: unknown[]) => IDBRequest).apply(this, args);
        };
      }
    }
    store.__zonaduaBroken.add(name);
  }, table);
}

/** The one global pill, mounted in App.svelte. Its text is uppercased by CSS. */
function toastText(page: Page) {
  return page.locator('[role="status"]');
}

/** Open the component sheet for the primary bike and return its dialog. */
async function openAddSheet(page: Page) {
  await page.getByRole('button', { name: /^add$/i }).first().waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: /^add$/i }).first().click();
  const sheet = page.getByRole('dialog', { name: /add component/i });
  await sheet.waitFor({ timeout: 10_000 });
  return sheet;
}

test.describe('failed writes are reported, never swallowed', () => {
  test('a component that fails to save keeps the sheet open and says why', async ({ page }) => {
    await openApp(page, '#/gear');

    const sheet = await openAddSheet(page);
    await breakWrites(page, 'components');
    const nameField = sheet.getByLabel('Name');
    await nameField.fill('Cassette');
    await sheet.getByRole('button', { name: /add component/i }).click();

    // the rider is told, in words that cannot be read as a confirmation
    await expect(toastText(page)).toContainText(/could not save cassette/i, { timeout: 10_000 });
    // and the sheet is still there with the typed value, because the write did not land
    await expect(nameField).toBeVisible();
    await expect(nameField).toHaveValue('Cassette');
  });

  test('a successful save confirms, and never says "could not"', async ({ page }) => {
    await openApp(page, '#/gear');

    const sheet = await openAddSheet(page);
    await sheet.getByLabel('Name').fill('Bar tape');
    await sheet.getByRole('button', { name: /add component/i }).click();

    await expect(toastText(page)).toContainText(/bar tape saved/i, { timeout: 10_000 });
    await expect(toastText(page)).not.toContainText(/could not/i);
    await expect(sheet).toBeHidden();
  });

  test('an unhandled rejection surfaces instead of living in the console', async ({ page }) => {
    await openApp(page);
    // a rejection nothing catches — the shape every forgotten `await` takes
    await page.evaluate(() => {
      void Promise.reject(new Error('e2e: unhandled'));
    });
    await expect(toastText(page)).toContainText(/something did not save/i, { timeout: 10_000 });
  });
});
