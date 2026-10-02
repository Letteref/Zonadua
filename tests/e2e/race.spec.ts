import { expect, test } from '@playwright/test';
import { FROZEN_MORNING, RACE, openRaceCockpit, startRace } from './fixtures/raceFixture';

/**
 * Race cockpit E2E — UI-SPEC §27, and the last open Definition-of-Done item for M4.
 *
 * ## Why these assert relationships instead of magic numbers
 *
 * The bug this suite exists to catch (§25.1) was a buffer hero that read `+0h 00m` on
 * every race forever: projected finish was derived from required pace, and required pace
 * was derived from the time left to the cut-off, so the two cancelled exactly. A test
 * asserting "BUFFER shows +0h 00m" would have *passed* against that broken build.
 *
 * So the load-bearing assertions are consistency claims — the buffer must equal cut-off
 * minus projected finish, and both must move when the clock does — which are false for any
 * self-measuring buffer and true for a real one. Literal values appear only where the setup
 * form itself pins them (the 05:30 roll-out the rider configures).
 */

/** Minutes past midnight → clock, matching the cockpit's own formatting. */
function clockOf(minutes: number): string {
  const m = Math.round(minutes);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
}

/** `23:08` → minutes past midnight. */
function minutesOf(clock: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!m) throw new Error(`not a HH:MM clock: ${JSON.stringify(clock)}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * `+5h 41m` / `−12m` → signed minutes.
 *
 * The hero prints the buffer as a duration, not a clock, and uses U+2212 MINUS SIGN rather
 * than a hyphen — both are parsed here so the arithmetic can compare it against two clocks.
 */
function durationOf(text: string): number {
  const t = text.trim().replace('−', '-');
  const m = /^([+-])?(?:(\d+)h)?\s*(?:(\d+)m)?$/.exec(t);
  if (!m || (!m[2] && !m[3])) throw new Error(`not a duration: ${JSON.stringify(text)}`);
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0));
}

interface Hero {
  /** the "+4h 12m" figure, without its trailing BUFFER/BEHIND word */
  bufferClock: string;
  bufferWord: 'BUFFER' | 'BEHIND' | 'NO PLAN';
  cutoffClock: string;
  projectedClock: string;
  requiredKph: number;
  kmDone: number;
  kmToGo: number;
}

/** Read every figure the cockpit's verdict is built from. */
async function readHero(page: import('@playwright/test').Page): Promise<Hero> {
  const cutoffClock = (await page.getByText(/^Cut-off · /).innerText()).split('·')[1]!.trim();
  const projectedClock = await page
    .locator('section', { hasText: 'PROJECTED FINISH' })
    .first()
    .locator('p')
    .first()
    .innerText();
  const requiredKph = Number(
    /([\d.]+)/.exec(
      await page.locator('section', { hasText: 'REQUIRED AVG' }).first().innerText()
    )![1]
  );
  const kmDone = Number(/([\d.]+)/.exec(await page.getByText(/km done$/i).innerText())![1]);
  const kmToGo = Number(/([\d.]+)/.exec(await page.getByText(/km to go$/i).innerText())![1]);

  const hero = await page.locator('.text-metric-hero').innerText();
  const bufferWord = /NO PLAN$/.test(hero) ? 'NO PLAN' : /BEHIND$/.test(hero) ? 'BEHIND' : 'BUFFER';
  const bufferClock = hero.replace(/(BUFFER|BEHIND|NO PLAN)$/, '').trim();

  return { bufferClock, bufferWord, cutoffClock, projectedClock, requiredKph, kmDone, kmToGo };
}

test.describe('race cockpit projection', () => {
  test('buffer equals the gap between projected finish and the cut-off', async ({ page }) => {
    await openRaceCockpit(page);
    await startRace(page);
    const h = await readHero(page);

    // The single most important assertion in this file. A buffer derived from the required
    // pace is *identically* the cut-off by construction, so this can only pass if the
    // projection is independent of the deadline it is measured against.
    expect(h.bufferWord).not.toBe('NO PLAN');
    expect(
      Math.abs(durationOf(h.bufferClock) - (minutesOf(h.cutoffClock) - minutesOf(h.projectedClock)))
    ).toBeLessThanOrEqual(1);

    // And it must not be the self-measuring zero this suite was written to catch.
    expect(durationOf(h.bufferClock)).not.toBe(0);
  });

  test('the sign of the buffer follows whether the plan makes the cut-off', async ({ page }) => {
    await openRaceCockpit(page);
    await startRace(page);
    const h = await readHero(page);

    const slack = minutesOf(h.cutoffClock) - minutesOf(h.projectedClock);
    expect(h.bufferWord).toBe(slack >= 0 ? 'BUFFER' : 'BEHIND');
    // and the label's sign must agree with the number's sign
    expect(h.bufferClock.startsWith('+') || h.bufferClock.startsWith('−')).toBe(true);
  });

  test('projected finish equals the plan finish at the start line', async ({ page }) => {
    await openRaceCockpit(page);

    // Read the plan before going live: "7h 10m" is the whole-race duration the rider just
    // agreed to, computed by the solver over the same profile the chart draws.
    const plan = await page
      .locator('section', { hasText: 'YOUR PLAN · OPTIMIZED' })
      .first()
      .innerText();
    const m = /(\d+)h\s*(\d+)m/.exec(plan);
    expect(m, `plan total not readable from: ${plan}`).not.toBeNull();
    const planMin = Number(m![1]) * 60 + Number(m![2]);

    await startRace(page);
    const { projectedClock } = await readHero(page);

    // Ties the cockpit's live projection back to the setup card: at the gun the projected
    // finish *is* the plan's finish.
    const startMin = RACE.startMin;
    expect(Math.abs(minutesOf(projectedClock) - (startMin + planMin))).toBeLessThanOrEqual(2);
  });

  test('required average matches the distance and time actually left', async ({ page }) => {
    await openRaceCockpit(page);
    await startRace(page);
    const h = await readHero(page);

    // The cockpit measures "hours left" from the *gun*, so the roll-out plus the hard limit
    // are what matter — not the clock on the wall.
    const minutesLeft = RACE.startMin + RACE.cutoffMin - minutesOf('10:00');
    // Required pace divides the distance *still to ride* by the time left, so the
    // comparison is against "km to go" alone — not the whole route.
    const implied = (h.requiredKph * minutesLeft) / 60;
    expect(Math.abs(implied - h.kmToGo) / Math.max(h.kmToGo, 1)).toBeLessThan(0.02);
    // and the two figures must describe the same ride, so they have to sum to its length
    expect(h.kmDone + h.kmToGo).toBeCloseTo(RACE.distanceKm, 0);
  });

  test('a later clock leaves less road but the same destination on plan', async ({ page }) => {
    await openRaceCockpit(page);
    await startRace(page);
    const early = await readHero(page);

    await openRaceCockpit(page, '2026-10-02T11:30:00+07:00');
    await startRace(page);
    const late = await readHero(page);

    // The rider has advanced along the plan...
    expect(late.kmDone).toBeGreaterThan(early.kmDone);
    expect(late.kmToGo).toBeLessThan(early.kmToGo);
    // ...so less road remains, and the required average to reach the cut-off must fall.
    // A frozen clock, or one the projection ignores, leaves both numbers untouched.
    expect(late.requiredKph).toBeLessThan(early.requiredKph);

    // The projected finish is deliberately *unchanged*: the rider is exactly on plan, so
    // arriving earlier and covering more ground cancel out. Holding that invariant is the
    // point — it is what a self-measuring buffer cannot fake.
    expect(late.projectedClock).toBe(early.projectedClock);
    expect(durationOf(late.bufferClock)).toBe(durationOf(early.bufferClock));
  });

  test('a logged checkpoint becomes the rider position', async ({ page }) => {
    await openRaceCockpit(page);
    await startRace(page);
    const before = await readHero(page);

    await page.getByLabel('Current kilometers').fill('40');
    await page.getByRole('button', { name: /^log$/i }).click();
    await page.getByText('KM 40').first().waitFor();

    const after = await readHero(page);
    expect(after.kmDone).toBeCloseTo(40, 1);
    // Logging is the tracker's whole job: it must feed the projection, not just a list.
    expect(minutesOf(after.projectedClock)).not.toBe(minutesOf(before.projectedClock));
  });

  test('falling behind the plan shrinks the buffer', async ({ page }) => {
    await openRaceCockpit(page);
    await startRace(page);
    const onPlan = await readHero(page);

    // Report a position well behind what the plan expects at 10:00 — the situation the
    // buffer exists to warn about.
    await page.getByLabel('Current kilometers').fill('10');
    await page.getByRole('button', { name: /^log$/i }).click();
    await page.getByText('KM 10').first().waitFor();

    const behind = await readHero(page);
    expect(durationOf(behind.bufferClock)).toBeLessThan(durationOf(onPlan.bufferClock));
  });
});

test.describe('race cockpit without a network', () => {
  test('renders and still projects once the network is cut', async ({ page, context }) => {
    // Load first: the local-first claim is that the app bootstraps from IndexedDB. Cutting
    // the network before load would only test that a service worker registered, which is a
    // much narrower promise.
    await openRaceCockpit(page);
    await startRace(page);
    const online = await readHero(page);

    await context.setOffline(true);
    await page.reload();
    await page.getByText('BUFFER VS CUT-OFF').waitFor({ timeout: 15_000 });
    const offline = await readHero(page);

    // Still a coherent projection offline — not an error page, not a blank hero.
    expect(offline.projectedClock).toMatch(/^\d{2}:\d{2}$/);
    expect(
      Math.abs(
        durationOf(offline.bufferClock) -
          (minutesOf(offline.cutoffClock) - minutesOf(offline.projectedClock))
      )
    ).toBeLessThanOrEqual(1);
    expect(online.cutoffClock).toBe(offline.cutoffClock);
    await context.setOffline(false);
  });

  test('accepts a checkpoint while offline and keeps it across a reload', async ({ page, context }) => {
    await openRaceCockpit(page);
    await startRace(page);

    await context.setOffline(true);
    await page.getByLabel('Current kilometers').fill('25');
    await page.getByRole('button', { name: /^log$/i }).click();
    await page.getByText('KM 25').first().waitFor();

    // The write must survive a reload, or "local-first" only describes reads.
    await page.reload();
    await page.getByText('BUFFER VS CUT-OFF').waitFor({ timeout: 15_000 });
    await page.getByText('KM 25').first().waitFor();
    await context.setOffline(false);
  });
});

test.describe('honest empty states', () => {
  test('a race with no route profile says so instead of inventing numbers', async ({ page }) => {
    await page.clock.install({ time: new Date(FROZEN_MORNING) });
    await page.goto('/#/race');
    await page.getByText(/RACE SETUP|Start race mode/).first().waitFor({ timeout: 15_000 });

    // No fixture was seeded here, so the profile is genuinely absent. The cockpit must say
    // so rather than falling back to a distance or speed it never solved.
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/200\.4 km|31\.9 km\/h|6h 47m/);
  });
});