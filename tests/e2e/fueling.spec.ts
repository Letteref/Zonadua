import { expect, test, type Page } from '@playwright/test';
import { openRaceCockpit } from './fixtures/raceFixture';

test.use({ serviceWorkers: 'block' });

async function openRace(page: Page): Promise<void> {
  await openRaceCockpit(page);
  // the plan has to solve before any fueling figure can exist
  await expect(page.getByText(/Your plan/i).first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Race fueling, end to end.
 *
 * The figures here need no API key and no network, which is the point being defended:
 * g/h is arithmetic on the rider's mass and the plan's energy, so gating it behind a
 * model would add a failure mode and a bill to the one number a rider reads on race
 * morning. If a regression put it behind `keySaved`, these tests would go quiet rather
 * than wrong, so they assert the number is present with no key saved at all.
 */
test.describe('race fueling needs no key and no network', () => {
  test('shows a gram-per-hour figure derived from the plan', async ({ page }) => {
    await openRace(page);

    await expect(page.getByText(/g carb \/ h/i)).toBeVisible({ timeout: 15_000 });

    // a real figure: not blank, not zero, and in the range the domain allows
    const heading = page.locator('text=/^\\d+$/').first();
    await expect(heading).toBeVisible();
    const grams = Number(await heading.innerText());
    // CARB_MIN_G_PER_H is the domain's own floor, so anything at or above it and at or
    // below the absorption ceiling is a figure the domain would actually produce
    expect(grams).toBeGreaterThanOrEqual(30); // CARB_MIN_G_PER_H
    expect(grams).toBeLessThanOrEqual(90); // MAX_CARB_G_PER_H is the hard ceiling

    // and the per-stop figure it divides into
    await expect(page.getByText(/MIX\s*\d+\s*G\s*×\s*\d+\s*STOPS/)).toBeVisible();
  });

  test('offers no briefing button without a key, and never pretends it did', async ({ page }) => {
    await openRace(page);

    await expect(page.getByRole('button', { name: /write race briefing/i })).toHaveCount(0);
    // and no invented briefing text stands in for the missing one
    await expect(page.getByText(/Briefing your race/)).toHaveCount(0);
  });

  test('never renders a zero where a figure is unknown', async ({ page }) => {
    await openRace(page);

    const card = page.locator('text=/Fueling/i').first();
    await expect(card).toBeVisible();

    // "0 g carb / h" would read as an instruction to ride unfuelled, which is both a
    // number nobody measured and bad advice
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/\b0\s*g carb \/ h/i);
  });
});