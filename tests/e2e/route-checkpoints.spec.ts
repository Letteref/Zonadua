import { expect, test, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test.use({ serviceWorkers: 'block' });

/**
 * The planner's checkpoint table (editable derived control points).
 *
 * Two claims are under test, both on the screen the rider actually uses:
 *  1. The table derives from the loaded GPX — the fixture is a ~10 km route, which
 *     earns three rows (two legs + finish), never the old hardcoded
 *     km 25/87/120/160/200.4 list every file used to show.
 *  2. The rider can edit km and label, add and remove points, reset to derived —
 *     and `Save as race plan` writes that list, not a stale one.
 *
 * Two harness details worth stating, because both silently broke earlier versions:
 *  - Labels live inside `<input value=…>`; Svelte writes `.value` as a property, so
 *    `getByText` and `input[value=…]` cannot see them. Read `.value` via evaluateAll,
 *    or address rows by position.
 *  - The km field commits on `change` (blur/Enter) by design — typing "12" on the way
 *    to "120" must not re-solve the plan mid-word. Playwright's `fill` dispatches only
 *    `input`, so every km edit is followed by a Tab to blur it, the way a rider commits.
 */

const GPX = fileURLToPath(new URL('./fixtures/route.gpx', import.meta.url));

function table(page: Page) {
  // the title breaks after "&" on purpose (two fixed lines), so match across the break
  return page.locator('section').filter({ hasText: /Checkpoints\s*&\s*control points/ }).locator('.rounded-2xl');
}

async function labels(page: Page): Promise<string[]> {
  return table(page)
    .locator('input[type="text"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
}

/** Fill a value and blur it — the commit gesture for a change-driven field. */
async function setAndCommit(input: Locator, value: string): Promise<void> {
  await input.fill(value);
  await input.press('Tab');
}

/** Boot the estimator fresh and import the fixture route (~10 km → three rows). */
async function openWithRoute(page: Page): Promise<void> {
  await page.goto(`/?r=${Date.now()}#/routes`);
  await page.locator('#app').waitFor({ timeout: 20_000 });
  await expect(table(page).first()).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles(GPX);
  await expect(table(page)).toHaveCount(3, { timeout: 20_000 });
}

test.describe('editable derived checkpoints', () => {
  test('the table derives from the GPX: legs plus a finish at the route end', async ({ page }) => {
    await openWithRoute(page);
    // nothing resembling the old hardcoded km 25/87/120/160/200.4 list
    const got = await labels(page);
    expect(got).toHaveLength(3);
    expect(got.at(-1)).toBe('Finish Line');
  });

  test('a rider renames, adds, removes and resets before saving', async ({ page }) => {
    await openWithRoute(page);
    const rows = table(page);

    // rename the finish row (label commits per keystroke — oninput)
    await rows.last().locator('input[type="text"]').fill('Done by dusk');
    expect((await labels(page)).at(-1)).toBe('Done by dusk');

    // add a point: mid-gap of [3.3, 6.7, 10.0] is km 5.0, sorting it to index 1
    await page.getByRole('button', { name: 'Add checkpoint' }).click();
    await expect(rows).toHaveCount(4);
    const added = rows.nth(1);
    await added.locator('input[type="text"]').fill('Fuel stop');
    await setAndCommit(added.locator('input[type="number"]'), '5');
    await expect(added.locator('input[type="number"]')).toHaveValue('5');
    expect(await labels(page)).toContain('Fuel stop');

    // Auto appears only while the list is customised, and restores the derived set
    const auto = page.getByRole('button', { name: 'Reset checkpoints to derived' });
    await expect(auto).toBeVisible();
    await auto.click();
    await expect(rows).toHaveCount(3);
    expect((await labels(page)).at(-1)).toBe('Finish Line');
    await expect(auto).toBeHidden();

    // remove a row, then add back the one the save will carry
    await rows.nth(1).getByRole('button', { name: 'Remove checkpoint 2' }).click();
    await expect(rows).toHaveCount(2);
    await page.getByRole('button', { name: 'Add checkpoint' }).click();
    await expect(rows).toHaveCount(3);
    await rows.nth(1).locator('input[type="text"]').fill('Fuel stop');

    // save: the race page must show the edited list, not the derived one
    await page.getByRole('button', { name: 'Save as race plan' }).click();
    await expect(page).toHaveURL(/#\/race/, { timeout: 15_000 });
    await expect(page.getByText('Fuel stop')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Done by dusk')).toHaveCount(0); // discarded by the Auto reset
  });

  test('an km edit is clamped to the route — past-the-end is not a checkpoint', async ({ page }) => {
    await openWithRoute(page);
    const rows = table(page);
    const kmInput = rows.first().locator('input[type="number"]');
    const maxKm = await kmInput.getAttribute('max'); // the route's true length
    await setAndCommit(kmInput, String(Number(maxKm) + 50));
    // clamped to the route end, which re-sorts that row to the bottom of the table
    await expect(rows.last().locator('input[type="number"]')).toHaveValue(maxKm!);
  });
});
