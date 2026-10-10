import { expect, test, type Page } from '@playwright/test';

/**
 * Dashboard render lock — the hero CTL chart, the "+N over 8w" pill, the 16-week heatmap.
 *
 * ## Why this suite exists
 *
 * The hero chart, its delta pill and the heatmap are all *derived* geometry: paths built
 * from the PMC series, an end-dot positioned from the same series, a 112-cell grid keyed
 * to calendar weeks, a colour ramp measured against the biggest day. Every one of those
 * was extracted into pure domain modules with unit tests, which proves the maths — and
 * proves nothing about the wiring: that the component still binds `endY` to the dot, that
 * the grid still has 112 children, that the pill still renders when the delta qualifies.
 * A wiring regression passes every unit test while the rider stares at a chart with no
 * dot on it. These tests close that gap at the DOM level.
 *
 * ## Why geometry and not screenshots
 *
 * `toHaveScreenshot` baselines are pinned to the machine that generated them (fonts,
 * antialiasing, DPR), so a Linux CI runner fails a Windows-authored baseline for reasons
 * that have nothing to do with the app. The claims that actually matter here are
 * structural — viewBox, path coordinates, cell counts, weekday alignment, the sum
 * invariant between grid and bars, which colour class each cell carries — and those are
 * exact across platforms. They catch a visual regression (a misaligned grid, a dot off
 * the line, an unwired colour ramp) without a single pixel of flake.
 *
 * ## Why the fixture writes its own rides
 *
 * The suite runs against the production build, which seeds no demo content: a fresh
 * profile is an empty log. `dashboardFixture` exists, but its TSS values are inputs to
 * *other* tests' assertions, and the heat-ramp test below needs values with a known
 * distance from the maximum (15/100 sits in the first band, 60/100 in the third). So
 * this file seeds seven rides of its own — deliberately without `np`, which keeps
 * `backfillMetrics` off the rows (`shouldSynthesiseTrace` only fires for `synthetic`
 * rows and the no-power estimator only fills a *missing* TSS), so the written score is
 * the score the heatmap buckets. Dates are relative to now because every window here —
 * the 84-day PMC, the 16 calendar weeks — is anchored on today.
 *
 * Written as raw IndexedDB rows after first paint, following `raceFixture.ts`: Dexie's
 * `liveQuery` only observes mutations made on its own connection, so a row inserted
 * through a second connection would only reach the UI after a reload.
 */

/** ago = days before now; tss chosen to land in every band of the heat ramp (max = 100). */
const RIDES = [
  { ago: 1, tss: 100 },
  { ago: 3, tss: 80 },
  { ago: 5, tss: 60 },
  { ago: 7, tss: 45 },
  { ago: 9, tss: 30 },
  { ago: 11, tss: 15 },
  { ago: 13, tss: 90 }
] as const;

const FIXTURE_TOTAL = RIDES.reduce((s, r) => s + r.tss, 0); // 420

async function seedRides(page: Page): Promise<void> {
  await page.evaluate(async (rides) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('zonadua');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const day = 86_400_000;
    const now = Date.now();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('activities', 'readwrite');
        const store = tx.objectStore('activities');
        for (const [i, r] of rides.entries()) {
          store.put({
            id: `hero-ride-${i}`,
            date: new Date(now - r.ago * day).toISOString(),
            name: `Hero fixture ride ${i + 1}`,
            source: 'manual',
            distanceKm: 30 + i * 4,
            movingSec: 3600,
            elapsedSec: 3900,
            elevGainM: 400,
            tss: r.tss,
            kcal: 700,
            synthetic: false,
            mVersion: 1,
            updatedAt: now
          });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, RIDES.map((r) => ({ ago: r.ago, tss: r.tss })));
}

/** Open the app at a route with a forced fresh document (the router is hash-based). */
async function openApp(page: Page, hash = '#/'): Promise<void> {
  await page.goto(`/?r=${Date.now()}${hash}`);
  await page.locator('#app').waitFor({ timeout: 20_000 });
}

/**
 * Sum of the TSS printed on the heatmap's cell titles, straight from the DOM.
 *
 * Returns -1 when the grid is not on screen yet, so `expect.poll` reports "never reached
 * the heatmap" instead of matching an absent grid against a coincidental total.
 */
async function cellTotal(page: Page): Promise<number> {
  return page.evaluate(() => {
    const h3 = [...document.querySelectorAll('h3')].find((h) =>
      (h.textContent ?? '').includes('16-Week Heatmap')
    );
    const grid = h3?.closest('section')?.querySelector('.grid-rows-7');
    if (!grid) return -1;
    return [...grid.children].reduce(
      (s, c) => s + Number(/: (\d+) TSS/.exec(c.getAttribute('title') ?? '')?.[1] ?? 0),
      0
    );
  });
}

/**
 * Fresh profile, fixture rides, reload, then wait until the rides are actually on screen.
 *
 * The wait keys on the heatmap total rather than on an element's presence: the chart
 * renders its empty-state geometry before IndexedDB answers, so "the svg exists" is true
 * of both the empty and the seeded dashboard and would let every assertion below pass
 * against the wrong state.
 */
async function openSeeded(page: Page): Promise<void> {
  await openApp(page);
  await seedRides(page);
  await page.reload();
  await page.locator('#app').waitFor({ timeout: 20_000 });
  await expect
    .poll(() => cellTotal(page), {
      timeout: 20_000,
      message: 'the fixture rides never reached the heatmap'
    })
    .toBe(FIXTURE_TOTAL);
}

/** The hero chart's svg, its three paths, the end dot and the delta pill, read raw. */
async function readHero(page: Page) {
  return page.evaluate(() => {
    const ctl = document.querySelector('path[stroke="url(#ctlLineGrad)"]');
    const svg = ctl?.closest('svg');
    if (!svg || !ctl) return null;
    const atl = svg.querySelector('path[stroke="#636266"]');
    const area = svg.querySelector('path[fill="url(#ctlAreaGrad)"]');
    const dot = svg.querySelector('circle');
    if (!atl || !area || !dot) return null;
    const d = (el: Element | null) => el?.getAttribute('d') ?? '';
    const pairs = (path: string): [number, number][] =>
      [...path.matchAll(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const ctlD = d(ctl);
    return {
      viewBox: svg.getAttribute('viewBox'),
      ctlD,
      atlD: d(atl),
      ctlPairs: pairs(ctlD),
      atlPairs: pairs(d(atl)),
      areaD: d(area),
      dot: { cx: Number(dot.getAttribute('cx')), cy: Number(dot.getAttribute('cy')) },
      pill:
        [...document.querySelectorAll('span')]
          .map((s) => (s.textContent ?? '').trim())
          .find((t) => /^[-+]?\d+ over 8w$/.test(t)) ?? null
    };
  });
}

/** The heatmap section: cells (date, tss, colour class), bars, labels, today's key. */
async function readHeatmap(page: Page) {
  return page.evaluate(() => {
    const h3 = [...document.querySelectorAll('h3')].find((h) =>
      (h.textContent ?? '').includes('16-Week Heatmap')
    );
    const section = h3?.closest('section');
    const grid = section?.querySelector('.grid-rows-7');
    if (!section || !grid) return null;

    const cells = [...grid.children].map((c) => {
      const title = c.getAttribute('title') ?? '';
      return {
        date: title.slice(0, 10),
        tss: Number(/: (\d+) TSS/.exec(title)?.[1] ?? 0),
        cls: (c.getAttribute('class') ?? '').split(/\s+/)
      };
    });

    const bars = [...section.querySelectorAll('div[title^="W"]')].map((b) => {
      const title = b.getAttribute('title') ?? '';
      return {
        label: title.split(':')[0],
        tss: Number(/: (\d+) TSS/.exec(title)?.[1] ?? 0),
        style: b.getAttribute('style') ?? ''
      };
    });

    const texts = [...section.querySelectorAll('span')].map((s) => (s.textContent ?? '').trim());
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;

    return {
      cells,
      bars,
      todayKey,
      avgLabel: texts.find((t) => t.includes('avg TSS')) ?? null,
      rangeLabel: texts.find((t) => t.includes('—') && t.includes('TSS')) ?? null
    };
  });
}

/** Calendar day `ago` days before `todayKey`, via UTC math so no local DST can shift it. */
const dayAgo = (todayKey: string, ago: number): string =>
  new Date(Date.parse(`${todayKey}T00:00:00Z`) - ago * 86_400_000).toISOString().slice(0, 10);

/**
 * Weekday of a calendar date key. Built from components rather than parsed from an ISO
 * string: `new Date('2026-10-09')` means UTC midnight, which reads as the *previous* day
 * in any zone behind UTC. The weekday of a calendar date itself is a pure fact, so this
 * agrees with the browser in Jakarta regardless of the test process's own zone.
 */
const weekdayOf = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};

test.describe('hero CTL chart', () => {
  test('draws both series, the area, and the dot on the end of the line', async ({ page }) => {
    await openSeeded(page);

    const hero = await readHero(page);
    expect(hero, 'the hero CTL chart never rendered').not.toBeNull();

    // the exact canvas the chart is authored against
    expect(hero!.viewBox).toBe('0 0 320 80');

    // both lines carry data: with rides in the log CTL and ATL diverge, so the two path
    // strings differ; a flat zero window would render them identically
    expect(hero!.ctlD).not.toBe(hero!.atlD);
    expect(hero!.ctlPairs.length).toBeGreaterThan(2);
    expect(
      new Set(hero!.ctlPairs.map(([, y]) => y)).size,
      'the CTL line is flat — the fixture load never reached the chart'
    ).toBeGreaterThan(1);

    // every coordinate stays inside the 320×80 box (y is bounded by the 12..72 plot band)
    for (const path of [hero!.ctlD, hero!.atlD]) {
      expect(path).not.toMatch(/NaN|Infinity/);
      for (const [x, y] of [...path.matchAll(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g)].map((m) => [
        Number(m[1]),
        Number(m[2])
      ])) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(320);
        expect(y).toBeGreaterThanOrEqual(12);
        expect(y).toBeLessThanOrEqual(72);
      }
    }

    // the line spans the full width — first sample at x=0, last at x=320
    expect(hero!.ctlPairs[0][0]).toBe(0);
    expect(hero!.ctlPairs.at(-1)![0]).toBe(320);

    // the area closes along the bottom edge
    expect(hero!.areaD.endsWith('L320,80 L0,80 Z')).toBe(true);

    // The dot rides exactly where the drawn line ends. This is the regression the domain
    // extraction fixed once already: endY derived from a different series (90-day vs the
    // 84-day one on screen) left the dot a hair off the line's final coordinate.
    expect(hero!.dot.cx).toBe(320);
    expect(
      hero!.dot.cy,
      'the end dot is not on the last point of the drawn CTL line'
    ).toBe(hero!.ctlPairs.at(-1)![1]);
  });
});

test.describe('the +8w delta pill', () => {
  test('reports the 8-week change of the series drawn beside it', async ({ page }) => {
    await openSeeded(page);

    const pill = page.getByText(/^[-+]?\d+ over 8w$/);
    await expect(pill).toBeVisible({ timeout: 20_000 });

    const text = (await pill.textContent())!.trim();
    expect(text).toMatch(/^[-+]\d+ over 8w$/);

    // Every fixture ride sits within the last 13 days, so the sample 56 days back on the
    // 84-day series is still untouched zero — fitness only rose, and the pill must read
    // positive. A sign flip here means the pill stopped measuring its own window.
    expect(text.startsWith('+'), `pill reads "${text}", expected a positive delta`).toBe(true);

    // …and it must agree with the series on screen: the pill and the chart read the same
    // `buildCtlChart` result, so a delta whose magnitude wildly exceeds the chart's own
    // scale would mean two different derivations are in play.
    const hero = await readHero(page);
    expect(hero).not.toBeNull();
    const delta = Number(text.match(/^([-+]?\d+) over 8w$/)![1]);
    expect(delta).toBeGreaterThanOrEqual(1);
    expect(delta).toBeLessThanOrEqual(72); // the plot band is 60px tall; delta is in points
  });
});

test.describe('16-week heatmap grid', () => {
  test('covers today in the last column, Sunday-first, and totals what the bars total', async ({
    page
  }) => {
    await openSeeded(page);

    const heat = await readHeatmap(page);
    expect(heat, 'the heatmap section never rendered').not.toBeNull();
    const { cells, bars, todayKey } = heat!;

    // 16 columns × 7 rows, column-major: row = weekday, Sunday = 0
    expect(cells).toHaveLength(112);
    cells.forEach((c, i) => {
      expect(
        weekdayOf(c.date),
        `cell ${i} (${c.date}) sits at row ${i % 7} but is not weekday ${i % 7}`
      ).toBe(i % 7);
    });
    expect(weekdayOf(cells[0].date)).toBe(0);

    // Today must be inside the grid — in the last column, on today's weekday row. The
    // pre-extraction grid anchored on (today − 111d) and dropped the current week for
    // six days out of seven; this is the regression that bug deserves.
    const todayIdx = cells.findIndex((c) => c.date === todayKey);
    expect(todayIdx, `today (${todayKey}) is not in the grid`).toBeGreaterThanOrEqual(0);
    expect(Math.floor(todayIdx / 7)).toBe(15);
    expect(todayIdx % 7).toBe(weekdayOf(todayKey));

    // sixteen bars, W1 (oldest) … W16 (current week), one per column
    expect(bars.map((b) => b.label)).toEqual(
      Array.from({ length: 16 }, (_, i) => `W${i + 1}`)
    );

    // The invariant that keeps the two views on one calendar: every bar equals its
    // column's total, and both views sum to exactly what was seeded. This fails if the
    // grid and the bars ever drift onto different week windows again.
    expect(cells.reduce((s, c) => s + c.tss, 0)).toBe(FIXTURE_TOTAL);
    expect(bars.reduce((s, b) => s + b.tss, 0)).toBe(FIXTURE_TOTAL);
    bars.forEach((b, w) => {
      const column = cells.slice(w * 7, w * 7 + 7).reduce((s, c) => s + c.tss, 0);
      expect(b.tss, `${b.label} does not match its grid column`).toBe(column);
    });

    // header labels read the same numbers the bars carry
    expect(heat!.rangeLabel).toMatch(/^\d+ — \d+ TSS$/);
    const rangeMax = Number(/— (\d+) TSS/.exec(heat!.rangeLabel!)![1]);
    expect(rangeMax).toBe(Math.max(...bars.map((b) => b.tss)));
    expect(heat!.avgLabel).toMatch(/^\d+ avg TSS$/);
    expect(Number(/(\d+) avg TSS/.exec(heat!.avgLabel!)![1])).toBeGreaterThan(0);
  });

  test('paints each cell’s band from its TSS against the grid maximum', async ({ page }) => {
    await openSeeded(page);

    const heat = await readHeatmap(page);
    expect(heat, 'the heatmap section never rendered').not.toBeNull();
    const { cells, todayKey } = heat!;

    const cellFor = (date: string) => {
      const c = cells.find((x) => x.date === date);
      expect(c, `no cell for ${date}`).toBeTruthy();
      return c!;
    };

    // exact TSS: the written score is the bucketed score — no estimator may have
    // rewritten these rows on the way in
    const band = (date: string) => {
      const c = cellFor(date);
      return { tss: c.tss, hot: c.cls.includes('bg-[#e0113c]') };
    };

    // max = 100 → f = tss/100 against the ramp's 25/50/75% cuts
    expect(band(dayAgo(todayKey, 1))).toEqual({ tss: 100, hot: true }); // 1.00 → 4
    expect(cellFor(dayAgo(todayKey, 5)).cls).toContain('bg-[#e0113c]/70'); // 60 → 3
    expect(cellFor(dayAgo(todayKey, 7)).cls).toContain('bg-[#ffad2e]/60'); // 45 → 2
    expect(cellFor(dayAgo(todayKey, 9)).cls).toContain('bg-[#ffad2e]/60'); // 30 → 2
    expect(cellFor(dayAgo(todayKey, 11)).cls).toContain('bg-[#ffad2e]/30'); // 15 → 1

    // a rest day stays the faint empty tile rather than picking up a band colour
    const rest = cells[0];
    expect(rest.tss).toBe(0);
    expect(rest.cls).toContain('bg-white/5');
    expect(rest.cls.join(' ')).not.toMatch(/ffad2e|e0113c/);
  });
});
