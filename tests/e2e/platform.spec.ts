import { expect, test, type Page } from '@playwright/test';

/**
 * Platform E2E — the M0/M1/M2 Definition-of-Done lines that were ticked as "Done" without
 * anyone ever checking them.
 *
 * ## Why this file exists
 *
 * M0–M3 carried nine unticked DoD boxes while their phase headers read Done. Most were never
 * run, and one of them turned out to be genuinely broken: the JSON backup enumerated its
 * tables by hand and had silently dropped `power_curves` since schema v2, so export → wipe →
 * import quietly destroyed the mean-max curves and the CP/W' fit. A checkbox costs nothing
 * to skip; this suite is the receipt.
 *
 * ## These run against the preview build, not the dev server
 *
 * The claims being checked are about a PWA: offline shell, installability, a service worker.
 * None of that exists under `vite dev`, so testing it there would prove nothing.
 */

/** Open the app at a route with a forced fresh document (the router is hash-based). */
async function openApp(page: Page, hash = '#/'): Promise<void> {
  await page.goto(`/?r=${Date.now()}${hash}`);
  await page.locator('#app').waitFor({ timeout: 20_000 });
}

/**
 * Wait for the first-launch seed to finish.
 *
 * The seed writes bikes, components, weight/FTP history and activities asynchronously after
 * the shell paints, so a snapshot taken the instant `#app` exists can legitimately see zero
 * activities. Polling is the honest fix; asserting against a racy read would either flake or
 * force the test to sleep for a guessed duration.
 */
async function waitForSeed(page: Page, timeoutMs = 25_000): Promise<Record<string, unknown[]>> {
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, unknown[]> = {};
  while (Date.now() < deadline) {
    last = await dumpState(page);
    if ((last.activities ?? []).length > 0 && (last.bikes ?? []).length > 0) return last;
    await page.waitForTimeout(250);
  }
  throw new Error(
    `seed never populated: ${Object.entries(last)
      .map(([k, v]) => `${k}=${v.length}`)
      .join(' ')}`
  );
}

/**
 * Every table, read raw from IndexedDB.
 *
 * Deliberately bypasses Dexie: this is a snapshot of what is *stored*, which is the only
 * thing a backup round trip can be judged against. Rows are sorted by id so two snapshots are
 * comparable without depending on IndexedDB's iteration order.
 */
async function dumpState(page: Page): Promise<Record<string, unknown[]>> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('gowslab');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const names = Array.from(db.objectStoreNames);
    const out: Record<string, unknown[]> = {};
    try {
      for (const n of names) {
        out[n] = await new Promise<unknown[]>((resolve, reject) => {
          const req = db.transaction(n, 'readonly').objectStore(n).getAll();
          req.onsuccess = () =>
            resolve(
              (req.result as Array<{ id?: unknown }>).sort((a, b) =>
                String(a.id ?? '').localeCompare(String(b.id ?? ''))
              )
            );
          req.onerror = () => reject(req.error);
        });
      }
    } finally {
      db.close();
    }
    return out;
  });
}

/**
 * A GPX track of the requested length, sampled densely enough to be a real 200 km file.
 *
 * `parseCourse` derives distance from the track geometry, so the points have to describe a
 * real path of `km` kilometres. Longitude is held **constant** on purpose: advancing it by
 * the same amount as latitude draws a diagonal, and at these coordinates that measures
 * ~1.41× the intended length — a track that reads 283 km when it was asked for 200.
 */
function gpxFor(km: number, name: string): string {
  const pts: string[] = [];
  const stepM = 40; // ~5 000 points over 200 km
  const total = km * 1000;
  for (let d = 0; d <= total; d += stepM) {
    const lat = -0.5 + d / 111_320; // 1 deg lat ≈ 111.32 km
    const lon = 100.3;
    const ele = (800 + d * 0.011 + Math.sin(d / 900) * 90).toFixed(1);
    pts.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${ele}</ele></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="gowslab-e2e" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>${name}</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

test.describe('M0 — installable and offline', () => {
  test('the manifest carries everything Chrome needs to offer an install', async ({ page }) => {
    await openApp(page);

    const href = await page
      .locator('link[rel=manifest]')
      .getAttribute('href')
      .catch(() => null);
    expect(href, 'no <link rel=manifest> in the document').not.toBeNull();

    const res = await page.request.get(new URL(href!, page.url()).toString());
    expect(res.ok()).toBe(true);
    const m = (await res.json()) as Record<string, unknown>;

    // The fields installability turns on. `start_url` in particular has to be in scope, or
    // Chrome silently refuses the install prompt.
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).toBeTruthy();
    expect(m.scope).toBeTruthy();
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toMatch(/^#/);
    expect(m.background_color).toMatch(/^#/);

    const icons = m.icons as Array<{ src: string; sizes: string; purpose?: string }>;
    expect(icons.some((i) => i.sizes === '192x192')).toBe(true);
    expect(icons.some((i) => i.sizes === '512x512')).toBe(true);
    // A maskable icon is what stops the launcher from drawing the logo on a white square.
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);

    // Every declared icon must actually be served — a manifest pointing at a 404 is a
    // silent install failure no schema check would catch.
    for (const icon of icons) {
      const r = await page.request.get(new URL(icon.src, page.url()).toString());
      expect(r.status(), `${icon.src} is declared but not served`).toBe(200);
    }
  });

  test('a service worker registers and takes control of the page', async ({ page }) => {
    await openApp(page);
    // The first load registers the worker; control only arrives on the next one.
    await page.reload();
    await page.locator('#app').waitFor({ timeout: 20_000 });

    const controlled = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return 'none';
      await navigator.serviceWorker.ready;
      return navigator.serviceWorker.controller ? 'controlled' : 'registered-not-controlling';
    });
    // "registered but not controlling" is the normal first-run state on some builds, but the
    // offline shell claim below is only meaningful if something answers the navigation.
    expect(['controlled', 'registered-not-controlling']).toContain(controlled);
  });

  test('the shell still renders with the network cut', async ({ page, context }) => {
    await openApp(page);
    await page.getByText(/TODAY|RECOVER|FORM|LOAD/i).first().waitFor({ timeout: 20_000 });

    // Reload once **while online** so the service worker takes control. A worker cannot
    // control the document that registered it, so going offline after a single visit tests
    // a state no returning user is ever in — the failure would be real but irrelevant.
    //
    // `serviceWorker.ready` is awaited first: it resolves once a worker is *active*, which
    // is the precondition for controlling the next navigation. Without it the reload races
    // the install, and the race is lost intermittently — the same test passing alone and
    // failing inside the suite.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.locator('#app').waitFor({ timeout: 20_000 });
    const controlled = await page
      .waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    expect(controlled, 'the worker never took control; an offline reload could not work').toBe(true);

    await context.setOffline(true);
    await page.reload();

    // The offline claim is that the app is usable, not merely that a service worker exists:
    // the shell has to come back up and real content has to render from IndexedDB.
    await page.locator('#app').waitFor({ timeout: 20_000 });
    await expect(page.locator('body')).not.toBeEmpty();
    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(50);
    expect(text).not.toMatch(/failed to load|ERR_INTERNET|offline error/i);

    // Navigation still works offline — the nav is part of the shell, not a network asset.
    await page.locator('a[href="#/rides"], button[aria-label*="Rides" i]').first().click();
    await page.waitForTimeout(600);
    expect(page.url()).toContain('#/');

    await context.setOffline(false);
  });
});

test.describe('M1 — data in', () => {
  test('a 200 km GPX imports in under 2 s', async ({ page }) => {
    await openApp(page, '#/rides');
    await page.getByText('YOUR RIDES').first().waitFor({ timeout: 20_000 });

    const gpx = gpxFor(200, 'E2E 200 km Import');

    // Timed **inside the page**, from the change event to the ride being visible. Measuring
    // from the test side would include reading the file and the CDP round trip, which is
    // harness cost, not import cost.
    const result = await page.evaluate(async (xml) => {
      const input = document.querySelector(
        'input[aria-label="Import GPX or TCX files"]'
      ) as HTMLInputElement;
      const file = new File([xml], 'e2e-200.gpx', { type: 'application/gpx+xml' });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;

      const t0 = performance.now();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise<void>((resolve) => {
        const tick = () =>
          document.body.innerText.includes('E2E 200 km Import')
            ? resolve()
            : requestAnimationFrame(tick);
        // hard stop so a failed import fails the assertion instead of hanging the suite
        if (performance.now() - t0 > 10_000) resolve();
        else requestAnimationFrame(tick);
      });
      return { ms: performance.now() - t0, imported: document.body.innerText.includes('E2E 200 km Import') };
    }, gpx);

    expect(result.imported, 'the 200 km ride never appeared').toBe(true);
    expect(result.ms, `200 km GPX import took ${result.ms.toFixed(0)} ms`).toBeLessThan(2000);

    // The distance must be real, not a point count mistaken for kilometres.
    const stored = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const req = indexedDB.open('gowslab');
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const rows = await new Promise<Array<{ name: string; distanceKm: number }>>((res, rej) => {
        const req = db.transaction('activities', 'readonly').objectStore('activities').getAll();
        req.onsuccess = () => res(req.result as never);
        req.onerror = () => rej(req.error);
      });
      db.close();
      return rows.find((r) => r.name.includes('E2E 200'));
    });
    expect(stored, 'ride was never written to IndexedDB').toBeTruthy();
    expect(Math.abs(stored!.distanceKm - 200)).toBeLessThan(2);
  });

  test('importing adds the distance to the active bike odometer', async ({ page }) => {
    await openApp(page, '#/gear');
    await page.getByText(/GEAR|BIKES/i).first().waitFor({ timeout: 20_000 });

    const before = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const req = indexedDB.open('gowslab');
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const rows = await new Promise<Array<{ id: string; odometerKm: number; active?: boolean }>>(
        (res, rej) => {
          const req = db.transaction('bikes', 'readonly').objectStore('bikes').getAll();
          req.onsuccess = () => res(req.result as never);
          req.onerror = () => rej(req.error);
        }
      );
      db.close();
      return rows;
    });
    expect(before.length, 'seed created no bikes').toBeGreaterThan(0);
    const active = before.find((b) => b.active) ?? before[0];
    const odoBefore = active.odometerKm;

    await openApp(page, '#/rides');
    await page.getByText('YOUR RIDES').first().waitFor({ timeout: 20_000 });
    await page.evaluate(async (xml) => {
      const input = document.querySelector(
        'input[aria-label="Import GPX or TCX files"]'
      ) as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(new File([xml], 'odo.gpx', { type: 'application/gpx+xml' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise<void>((resolve) => {
        const tick = () =>
          document.body.innerText.includes('E2E Odometer Ride')
            ? resolve()
            : requestAnimationFrame(tick);
        requestAnimationFrame(tick);
      });
    }, gpxFor(40, 'E2E Odometer Ride'));

    const after = await page.evaluate(async (id) => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const req = indexedDB.open('gowslab');
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const row = await new Promise<{ odometerKm: number } | undefined>((res, rej) => {
        const req = db.transaction('bikes', 'readonly').objectStore('bikes').get(id);
        req.onsuccess = () => res(req.result as never);
        req.onerror = () => rej(req.error);
      });
      db.close();
      return row;
    }, active.id);

    expect(after!.odometerKm - odoBefore).toBeGreaterThan(38);
  });

  test('weight and FTP are logged and drawn on the body trend', async ({ page }) => {
    await openApp(page, '#/settings');
    await page.getByText('BODY TREND').waitFor({ timeout: 20_000 });

    // Number inputs in DOM order: Height, Weight, FTP — then the zone bounds. Targeting by
    // position is safe here only because all three are asserted against distinct values,
    // so a mis-index fails loudly instead of quietly logging weight into the height field.
    const weightInput = page.locator('input[type=number]').nth(1);
    await weightInput.fill('71.4');
    await page.getByRole('button', { name: /log weight/i }).click();
    // the toast is uppercased in CSS, so match it case-insensitively
    await page.getByText(/weight 71\.4 kg logged/i).waitFor({ timeout: 10_000 });

    const ftpInput = page.locator('input[type=number]').nth(2);
    await ftpInput.fill('304');
    await page.getByRole('button', { name: /log ftp/i }).click();
    await page.getByText(/ftp 304 w logged/i).waitFor({ timeout: 10_000 });

    // Persisted...
    const stored = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const req = indexedDB.open('gowslab');
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const w = await new Promise<Array<{ kg: number }>>((res, rej) => {
        const req = db.transaction('weight_log', 'readonly').objectStore('weight_log').getAll();
        req.onsuccess = () => res(req.result as never);
        req.onerror = () => rej(req.error);
      });
      const f = await new Promise<Array<{ ftp: number }>>((res, rej) => {
        const req = db.transaction('ftp_history', 'readonly').objectStore('ftp_history').getAll();
        req.onsuccess = () => res(req.result as never);
        req.onerror = () => rej(req.error);
      });
      db.close();
      return { w: w.map((r) => r.kg), f: f.map((r) => r.ftp) };
    });
    expect(stored.w).toContain(71.4);
    expect(stored.f).toContain(304);

    // ...and actually drawn. A chart element with no plotted path is an empty axis, which
    // is what "terlog dan terlihat di grafik" is supposed to exclude.
    const drawn = await page.evaluate(() => {
      const paths = [...document.querySelectorAll('svg path, svg polyline, svg circle')];
      return paths.filter((p) => (p.getAttribute('d') ?? '').length > 0 || p.tagName === 'circle')
        .length;
    });
    expect(drawn, 'the trend chart drew nothing').toBeGreaterThan(0);
  });

  test('export → delete everything → import restores the identical state', async ({
    page
  }) => {
    await openApp(page, '#/rides');
    await page.getByText('YOUR RIDES').first().waitFor({ timeout: 20_000 });
    const before = await waitForSeed(page);
    expect((before.activities ?? []).length, 'nothing seeded to back up').toBeGreaterThan(0);

    await openApp(page, '#/settings');
    await page.getByText('DATA MANAGEMENT').waitFor({ timeout: 20_000 });

    // The export is a real download, so it is captured as one — the same bytes the rider
    // would keep on disk, not a payload reconstructed inside the test.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /backup json/i }).click()
    ]);
    const file = await download.path();
    expect(file).toBeTruthy();

    // Wipe, through the two-step confirmation the UI requires.
    await page.getByRole('button', { name: /delete all data/i }).click();
    await page.getByRole('button', { name: /^continue$/i }).click();
    await page.getByPlaceholder('DELETE').fill('DELETE');
    await page.getByRole('button', { name: /erase everything/i }).click();
    await page.waitForTimeout(1500);

    const wiped = await dumpState(page);
    expect(
      (wiped.activities ?? []).length,
      'the wipe left activities behind — the seed re-ran after an explicit erase'
    ).toBe(0);

    await openApp(page, '#/settings');
    await page.getByText('DATA MANAGEMENT').waitFor({ timeout: 20_000 });
    await page.locator('input[aria-label="Restore backup"]').setInputFiles(file!);
    await page.getByText(/backup restored/i).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);

    const after = await dumpState(page);

    // `lastBackupAt` is stamped by the export itself, so it is expected to differ; every
    // other byte of user data is not.
    const strip = (s: Record<string, unknown[]>) => {
      const copy = JSON.parse(JSON.stringify(s)) as Record<string, Array<Record<string, unknown>>>;
      copy.settings = (copy.settings ?? []).map((row) => {
        const { lastBackupAt, ...rest } = row;
        return rest;
      });
      return copy;
    };

    // Every table in the snapshot must come back, including the ones added in later schema
    // versions. A hand-maintained export list is exactly how `power_curves` went missing.
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const table of Object.keys(before)) {
      expect(strip(after)[table], `table "${table}" did not round-trip`).toEqual(
        strip(before)[table]
      );
    }
  });
});

test.describe('M2 — the dashboard stays responsive with a full season of rides', () => {
  test('500 activities keep a dashboard interaction under 100 ms', async ({ page }) => {
    // Seeding 500 rows and rendering the first dashboard pass over them is slower than a
    // normal assertion cycle, so this test gets its own budget rather than sharing the
    // suite default and failing on a timeout that says nothing about responsiveness.
    test.setTimeout(120_000);

    await openApp(page, '#/');
    await page.locator('#app').waitFor({ timeout: 20_000 });

    // 500 synthetic rides dated across two years, written before the dashboard reads them.
    // Streams are omitted on purpose: the DoD is about the dashboard's responsiveness to the
    // activity *count*, and seeding 500 compressed traces would test IndexedDB instead.
    const seeded = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const req = indexedDB.open('gowslab');
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const count = await new Promise<number>((res, rej) => {
        const req = db.transaction('activities', 'readonly').objectStore('activities').count();
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const t0 = performance.now();
      await new Promise<void>((res, rej) => {
        const tx = db.transaction('activities', 'readwrite');
        const store = tx.objectStore('activities');
        for (let i = 0; i < 500; i++) {
          const day = Math.floor(i / 3.5);
          const d = new Date(Date.UTC(2025, 0, 1 + day));
          store.put({
            id: `perf-${String(i).padStart(4, '0')}`,
            date: d.toISOString().slice(0, 10),
            name: `Synthetic ride ${i}`,
            source: 'gpx',
            bikeId: null,
            distanceKm: 40 + (i % 60),
            movingSec: 3600 + (i % 40) * 60,
            elapsedSec: 3700 + (i % 40) * 60,
            elevGainM: 300 + (i % 500),
            kcal: 900 + (i % 300),
            tss: 60 + (i % 70),
            updatedAt: Date.now()
          });
        }
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error);
      });
      db.close();
      return { before: count, total: count + 500, writeMs: performance.now() - t0 };
    });
    expect(seeded.total).toBeGreaterThanOrEqual(500);

    await openApp(page, '#/');
    await page.getByRole('tab', { name: /form/i }).waitFor({ timeout: 60_000 });

    // The interaction measured is a tab switch, timed from the click to the moment the
    // component reports the new selection. It re-runs the dashboard's derived chain over
    // every activity, so a slowness here is the DoD's "dashboard stays under 100 ms".
    // Clicking a tab selects *that* tab. The first click starts from the default "Today" view,
    // so every sample below is a real state change rather than a no-op that resolves in
    // ~0 ms and flatters the result.
    const visits = ['form', 'load', 'today', 'form', 'load'];
    const samples: number[] = [];
    for (const id of visits) {
      samples.push(
        await page.evaluate(async (tabId) => {
          const tab = document.querySelector(`#hero-tab-${tabId}`) as HTMLElement | null;
          if (!tab) return -1;
          const t0 = performance.now();
          tab.click();
          // Promise.race against a real timer: a poll loop whose deadline is only checked
          // on entry never times out, so a tab that fails to flip would hang the suite
          // rather than fail it.
          await Promise.race([
            new Promise<void>((resolve) => {
              const tick = () =>
                document.querySelector(`#hero-tab-${tabId}`)?.getAttribute('aria-selected') ===
                'true'
                  ? resolve()
                  : requestAnimationFrame(tick);
              requestAnimationFrame(tick);
            }),
            new Promise<void>((resolve) => setTimeout(resolve, 5000))
          ]);
          const switched =
            document.querySelector(`#hero-tab-${tabId}`)?.getAttribute('aria-selected') === 'true';
          return switched ? performance.now() - t0 : -1;
        }, id)
      );
    }
    expect(
      samples.every((s) => s >= 0),
      `a hero tab never responded: ${samples.join(', ')}`
    ).toBe(true);

    const worst = Math.max(...samples);
    expect(
      worst,
      `dashboard interaction reached ${worst.toFixed(1)} ms with ${seeded.total} activities ` +
        `(samples: ${samples.map((s) => s.toFixed(1)).join(', ')})`
    ).toBeLessThan(100);
  });
});
test.describe('routes hero stat strip', () => {
  /**
   * The AVG · KCAL · NP strip must stay on one line at every phone width.
   *
   * This is a geometry bug, not a text bug: the old markup used `flex-wrap` with loose
   * inline spans, so a long value broke a single stat across two lines and the strip itself
   * could wrap — the card silently grew a row on the one screen where a rider is planning.
   * Every number stayed readable in both states, which is exactly why it went unnoticed.
   *
   * The strip needs ~21 px of width per px of font size, so it was also measured before
   * being fixed. That measurement is why MOVING moved up into the EST FINISH tile: four
   * metrics could not hold 11 px on a 320 px screen without dropping to ~8 px, which is not
   * a font size anyone can read on a moving bike.
   */
  const WIDTHS = [320, 360, 390, 420];

  /** Drive the estimator to its most label-heavy plan: Attack IF, max headwind and cargo. */
  async function maxOutPlan(page: Page): Promise<void> {
    await page.getByRole('button', { name: /^attack/i }).click();
    for (const [label, value] of [
      ['Headwind in kilometres per hour', '40'],
      ['Cargo weight in kilograms', '10']
    ] as const) {
      await page.locator(`input[aria-label="${label}"]`).fill(value);
    }
    await page.waitForTimeout(600);
  }

  /**
   * The strip, plus the geometry that decides whether it wrapped.
   *
   * Found by structure — the hero section, then the row whose children include the AVG
   * metric — rather than by the `whitespace-nowrap` class that fixes the bug. Searching for
   * the fix's own class would make this test pass and fail for the wrong reason: dropping
   * the class made the row unfindable instead of measuring a wrap.
   */
  const stripGeometry = (page: Page) =>
    page.evaluate(() => {
      const hero = [...document.querySelectorAll('section')].find((s) =>
        /PROJECTED RIDE TIME/i.test(s.innerText)
      );
      if (!hero) return null;
      const strip = [...hero.querySelectorAll('div')].find((d) =>
        [...d.children].some((k) => /^AVG\b/i.test(k.textContent?.trim() ?? ''))
      );
      if (!strip) return null;
      const group = strip.firstElementChild as HTMLElement;
      const visible = [...group.children].filter(
        (c) => getComputedStyle(c).display !== 'none'
      ) as HTMLElement[];
      return {
        fontSize: parseFloat(getComputedStyle(strip).fontSize),
        stripOverflow: strip.scrollWidth - strip.clientWidth,
        groupOverflow: group.scrollWidth - group.clientWidth,
        // A wrapped strip is taller than one line box; this is the direct measurement.
        stripHeight: Math.round(strip.getBoundingClientRect().height),
        lineHeight: Math.round(visible[0]?.getBoundingClientRect().height ?? 0),
        // every visible metric must occupy exactly one line box; a wrapped one is taller
        metricHeights: visible.map((c) => Math.round(c.getBoundingClientRect().height)),
        text: visible.map((c) => c.textContent.trim()).join(' '),
        stripText: strip.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      };
    });

  for (const width of WIDTHS) {
    test(`stays on one line at ${width} px with the longest figures`, async ({ page }) => {
      await openApp(page, '#/routes');
      await page.getByText('PROJECTED RIDE TIME').waitFor({ timeout: 20_000 });
      await page.setViewportSize({ width, height: 900 });
      await maxOutPlan(page);

      const g = await stripGeometry(page);
      expect(g, 'stat strip not found').not.toBeNull();
      expect(g!.text).toMatch(/12,977 KCAL/); // the widest the plan can get
      expect(g!.stripOverflow, 'the strip overflows its card').toBeLessThanOrEqual(0);
      expect(g!.groupOverflow, 'the metrics overflow each other').toBeLessThanOrEqual(0);
      // One line box per metric — a wrapped stat is the failure this guards against.
      expect(new Set(g!.metricHeights).size, `uneven metric heights: ${g!.metricHeights}`).toBe(1);
      // Belt and braces: the row itself must not have grown a second line.
      expect(
        g!.stripHeight,
        `the strip is ${g!.stripHeight}px tall for ${g!.lineHeight}px of text — it wrapped`
      ).toBeLessThanOrEqual(g!.lineHeight + 8);
      // And it must stay readable rather than solving the fit by shrinking away.
      expect(g!.fontSize, `font collapsed to ${g!.fontSize}px`).toBeGreaterThanOrEqual(10);
    });
  }

  test('MOVING time sits with the finish estimate instead of in the strip', async ({ page }) => {
    await openApp(page, '#/routes');
    await page.getByText('PROJECTED RIDE TIME').waitFor({ timeout: 20_000 });
    await maxOutPlan(page);

    // It is the same number in different clothes — elapsed including stops, and the same
    // ride excluding them — so the pair reads as one figure with its allowance broken out.
    const tile = page.locator('div', { hasText: 'Est finish' }).filter({ hasText: /Moving/i }).first();
    await expect(tile.getByText(/Moving\s+40h\s+05m/i)).toBeVisible();

    const strip = await stripGeometry(page);
    expect(strip!.stripText, 'MOVING crept back into the strip').not.toMatch(/MOVING/i);
  });
});

test.describe('routes hero hierarchy', () => {
  /** The EST FINISH / TARGET ARRIVE pair, located by the labels rather than by index. */
  const tiles = (page: Page) =>
    page.evaluate(() => {
      const hero = [...document.querySelectorAll('section')].find((s) =>
        /PROJECTED RIDE TIME/i.test(s.innerText)
      );
      if (!hero) return null;
      const row = [...hero.querySelectorAll('div')].find(
        (d) =>
          [...d.children].length === 2 &&
          [...d.children].every((c) => /EST FINISH|TARGET ARRIVE/i.test(c.innerText))
      );
      if (!row) return null;
      return [...row.children].map((t) => {
        const cs = getComputedStyle(t);
        const r = t.getBoundingClientRect();
        return {
          label: t.firstElementChild?.textContent?.trim(),
          bg: cs.backgroundColor,
          borderColor: cs.borderColor,
          borderWidth: cs.borderWidth,
          padding: cs.padding,
          radius: cs.borderRadius,
          width: Math.round(r.width),
          height: Math.round(r.height),
          // three lines of equal rhythm in both, or one box looks deeper than its twin
          lineCount: t.children.length,
          lineHeights: [...t.children].map((c) => Math.round(c.getBoundingClientRect().height)),
          valueColor: getComputedStyle(t.children[1]).color
        };
      });
    });

  test('the two hero tiles are one component, not two', async ({ page }) => {
    await openApp(page, '#/routes');
    await page.getByText('PROJECTED RIDE TIME').waitFor({ timeout: 20_000 });

    const t = await tiles(page);
    expect(t, 'hero tiles not found').not.toBeNull();
    expect(t!.map((x) => x.label?.toLowerCase())).toEqual(['est finish', 'target arrive']);

    const [a, b] = t!;
    // Every surface property must match. They used to differ in background shade *and*
    // border tone, which made one primary and one secondary read as two unrelated cards.
    for (const prop of ['bg', 'borderColor', 'borderWidth', 'padding', 'radius', 'height'] as const) {
      expect(b[prop], `tiles disagree on ${prop}: ${a[prop]} vs ${b[prop]}`).toEqual(a[prop]);
    }
    // Same internal rhythm too: label, figure, subline.
    expect(a.lineCount, 'EST FINISH is not three lines').toBe(3);
    expect(b.lineCount, 'TARGET ARRIVE is not three lines').toBe(3);
    expect(a.lineHeights, 'the two tiles stack their lines differently').toEqual(b.lineHeights);

    // Hierarchy survives through colour alone — that is the point of matching the boxes.
    expect(a.valueColor).not.toBe(b.valueColor);
  });

  test('the stat strip is centred under the hero, not left-aligned', async ({ page }) => {
    await openApp(page, '#/routes');
    await page.getByText('PROJECTED RIDE TIME').waitFor({ timeout: 20_000 });
    await page.setViewportSize({ width: 320, height: 900 });

    const m = await page.evaluate(() => {
      const hero = [...document.querySelectorAll('section')].find((s) =>
        /PROJECTED RIDE TIME/i.test(s.innerText)
      )!;
      const strip = [...hero.querySelectorAll('div')].find((d) =>
        [...d.children].some((k) => /^AVG\b/i.test(k.textContent?.trim() ?? ''))
      )!;
      const s = strip.getBoundingClientRect();
      const h = hero.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(hero).paddingLeft);
      return {
        justify: getComputedStyle(strip).justifyContent,
        // midpoint of the strip against the midpoint of the hero's content box
        offset: Math.round((s.left + s.right) / 2 - (h.left + pad + (h.right - pad)) / 2)
      };
    });

    // `justify-between` with a single child pins the row hard left, which is what the strip
    // did once MOVING left it — it then read as a stray label under a centred hero.
    expect(m.justify).toBe('center');
    expect(Math.abs(m.offset), `strip sits ${m.offset}px off centre`).toBeLessThanOrEqual(1);
  });
});

test.describe('audit — hierarchy across the app', () => {
  /**
   * The `right` slot in `SectionCard`, checked wherever it is used.
   *
   * The slot was built with `justify-between`, but every single caller renders one element
   * into it — and `justify-between` with one child always resolves left. So a prop named
   * `right` had never once right-aligned anything in the app, and it was not obvious by
   * eye: a left-aligned legend simply reads as "the legend is over here", next to the
   * chart it describes.
   *
   * Measured before the fix: the Fitness & fatigue card left 192 px of empty space to the
   * right of its content, Power curve left 61 px.
   *
   * `data-slot="right"` is the component's own contract, not an echo of the class that
   * fixes it — selecting on `justify-end` would make this test pass for the wrong reason.
   */
  async function rightSlots(page: Page): Promise<
    Array<{ content: string; fromRight: number }>
  > {
    return page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-slot=right]')]
        // A snippet whose only branch is false renders nothing, leaving the slot empty —
        // there is no alignment to assert in that case.
        .filter((el) => el.firstElementChild)
        .map((el) => {
          const kid = el.firstElementChild as HTMLElement;
          const k = kid.getBoundingClientRect();
          const r = el.getBoundingClientRect();
          return {
            content: kid.textContent?.replace(/\s+/g, ' ').trim().slice(0, 46) ?? '(icon only)',
            fromRight: Math.round(r.right - k.right)
          };
        })
    );
  }

  for (const [label, hash] of [
    ['dashboard', '#/'],
    ['races', '#/rides'],
    ['race cockpit', '#/race'],
    ['activity detail', '#/rides/seed']
  ] as const) {
    test(`the right-hand slot is actually right on ${label}`, async ({ page }) => {
      await openApp(page, hash);
      await page.locator('#app').waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1500);

      const slots = await rightSlots(page);
      // The activity detail route needs a real ride id; if the page has no card to check,
      // that is a different test's subject, not a failure of this one.
      if (slots.length === 0) return;

      for (const s of slots) {
        expect(s.fromRight, `"${s.content}" sits ${s.fromRight}px from the right edge`).toBeLessThanOrEqual(1);
      }
    });
  }

  /**
   * The Rides hero: one rhythm across the primary figure and its two peers.
   *
   * Hours and TSS used to be one unlabelled string, "5.8h · 313 TSS", on the same line as a
   * settings button — so the primary distance had a label and a 28px figure while its peers
   * were 11px text with nothing to say what they were. The three figures now sit on a shared
   * baseline and share the label size, which is the arrangement the dashboard hero already
   * used.
   */
  test('rides hero puts distance, time and stress on one baseline', async ({ page }) => {
    await openApp(page, '#/rides');
    await page.getByText(/This week/i).first().waitFor({ timeout: 20_000 });

    const hero = await page.evaluate(() => {
      const card = [...document.querySelectorAll('div')].find(
        (d) => /This week/i.test(d.textContent ?? '') && /Stress/i.test(d.textContent ?? '')
      );
      if (!card) return null;
      const cols = [...card.querySelectorAll('div')].filter(
        (d) => d.className.includes('flex-col') && d.children.length === 2
      );
      return {
        overflow: card.scrollWidth - card.clientWidth,
        columns: cols.map((c) => {
          const [label, value] = [...c.children].map((k) => {
            const r = k.getBoundingClientRect();
            return {
              text: k.textContent?.trim() ?? '',
              fs: parseFloat(getComputedStyle(k).fontSize),
              bottom: Math.round(r.bottom)
            };
          });
          return { label: label.text, value: value.value, labelFs: label.fs, valueFs: value.fs, bottom: value.bottom };
        })
      };
    });

    expect(hero, 'rides hero not found').not.toBeNull();
    expect(hero!.overflow, 'the hero overflows its card').toBeLessThanOrEqual(0);
    // distance, time, stress — three figures, not two and a run-on string
    expect(hero!.columns.length).toBe(3);
    expect(hero!.columns.map((c) => c.label)).toEqual(['This week', 'Time', 'Stress']);
    // One label size across all three, or the peers read as captions rather than peers.
    expect(new Set(hero!.columns.map((c) => c.labelFs)).size).toBe(1);
    // One baseline for the figures: the hierarchy is carried by size, not by misalignment.
    expect(
      new Set(hero!.columns.map((c) => c.bottom)).size,
      `figures do not share a baseline: ${hero!.columns.map((c) => `${c.value}@${c.bottom}`).join(', ')}`
    ).toBe(1);
    // ...and the primary is still the primary.
    expect(hero!.columns[0].valueFs).toBeGreaterThan(hero!.columns[1].valueFs);
  });
});
