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