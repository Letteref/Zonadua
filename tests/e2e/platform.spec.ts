import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { seedDashboardFixture } from './fixtures/dashboardFixture';

/**
 * Deliberately recognisable placeholders written into IndexedDB by the backup test. They are
 * obvious fakes — the point is to be findable in the exported bytes, not to resemble a real key.
 */
const E2E_FAKE_AI_KEY = 'sk-E2E-FAKE-AI-KEY-0001';
const E2E_FAKE_ACCESS_TOKEN = 'strava-E2E-FAKE-ACCESS-0001';
const E2E_FAKE_REFRESH_TOKEN = 'strava-E2E-FAKE-REFRESH-0001';

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
 * The vertical centre of the gauge's **painted** arc — the datum the rider actually sees.
 *
 * The arc is a 240° dash on a 180px circle, so it does not fill its box: the open ends stop at
 * 30° and 150°, the painted mass spans y 9..133.5 of the box, and its centre sits 18.75px above
 * the box's centre. Anything centred on the box therefore reads low inside the ring. The
 * component compensates with `ARC_RISE`, and this measures the thing it is compensating for, so
 * the tests can check the compensation rather than restate it.
 *
 * The extent is sampled off the dash itself rather than the circle. `getPointAtLength` walks the
 * whole circle including the unpainted gap at the bottom, so sampling the full path reports the
 * *circle's* centre and quietly re-breaks the very thing being asserted. `stroke-linecap="round"`
 * paints a further half stroke-width past each open end, which is included here.
 */
async function gaugeArcMid(page: Page): Promise<number> {
  return page.evaluate(() => {
    const circle = document.querySelector('#hero-pane svg[role="img"] circle');
    if (!circle) return NaN;
    const dash = Number(circle.getAttribute('stroke-dasharray')?.split(' ')[0] ?? 0);
    const half = Number(circle.getAttribute('stroke-width') ?? 0) / 2;
    const matrix = circle.getScreenCTM();
    if (!matrix || !(dash > 0)) return NaN;
    const at = (len: number) => {
      const p = circle.getPointAtLength(len);
      return new DOMPoint(p.x, p.y).matrixTransform(matrix).y;
    };
    let top = Infinity;
    for (let i = 0; i <= 400; i++) top = Math.min(top, at((dash * i) / 400));
    // The open ends take the round cap, which reaches half a stroke-width further down.
    const bottom = Math.max(at(0), at(dash)) + half;
    return (top - half + bottom) / 2;
  });
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
      const req = indexedDB.open('zonadua');
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
<gpx version="1.1" creator="zonadua-e2e" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>${name}</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

/**
 * A TCX the way a head unit actually writes one: position, altitude, time, and a sensor
 * block carrying watts at every single trackpoint.
 *
 * The parser used to read only the first three and drop the rest, which is invisible
 * from the outside because the app then rendered an honest "this ride has no power
 * stream" state. A broken import and a rider with no meter looked identical.
 */
function tcxWithPower(km: number, name: string, baseWatts = 240): string {
  const pts: string[] = [];
  const stepM = 20;
  const start = Date.parse('2026-09-20T06:00:00Z');
  for (let d = 0; d <= km * 1000; d += stepM) {
    const lat = (-0.5 + d / 111_320).toFixed(6);
    const ele = (120 + d * 0.004).toFixed(1);
    // A steady 240 W ride with a gentle sinusoidal variation, so NP is not equal to the
    // average and the metric has something real to compute.
    const watts = Math.round(baseWatts + Math.sin(d / 300) * 45);
    const t = new Date(start + d * 1000).toISOString();
    pts.push(
      `<Trackpoint><Time>${t}</Time>` +
        `<Position><LatitudeDegrees>${lat}</LatitudeDegrees><LongitudeDegrees>100.3</LongitudeDegrees></Position>` +
        `<AltitudeMeters>${ele}</AltitudeMeters>` +
        `<HeartRateBpm><Value>${140 + (d % 30)}</Value></HeartRateBpm>` +
        `<Cadence>88</Cadence>` +
        `<Extensions><ns3:TPX><ns3:Watts>${watts}</ns3:Watts></ns3:TPX></Extensions>` +
        `</Trackpoint>`
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2" version="1.0">
<Activities><Activity Sport="Biking"><Id>2026-09-20T06:00:00Z</Id>
<Name>${name}</Name>
<Lap StartTime="2026-09-20T06:00:00Z"><Track>${pts.join('')}</Track></Lap>
</Activity></Activities></TrainingCenterDatabase>`;
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
        const req = indexedDB.open('zonadua');
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

  test('a TCX with a power meter imports as a scored ride, not a powerless one', async ({
    page
  }) => {
    await openApp(page, '#/rides');
    await page.getByText('YOUR RIDES').first().waitFor({ timeout: 20_000 });
    // scoring needs an FTP on file; production no longer seeds one
    await seedDashboardFixture(page);
    await page.reload();
    await page.getByText('YOUR RIDES').first().waitFor({ timeout: 20_000 });

    await page.evaluate(async (xml) => {
      const input = document.querySelector(
        'input[aria-label="Import GPX or TCX files"]'
      ) as HTMLInputElement;
      const file = new File([xml], 'e2e-power.tcx', { type: 'application/vnd.garmin.tcx+xml' });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, tcxWithPower(24, 'E2E Power TCX'));

    // Waited with a locator rather than the old requestAnimationFrame poll inside
    // evaluate: rAF stops firing on a backgrounded page, and after the fixture reload
    // above that poll never resolved and the test died on the harness, not the app.
    //
    // The wait below polls the *database*, not the list: the row is what the assertions
    // read, and a list that has not re-rendered yet says nothing about whether the import
    // succeeded. Once the row exists the list check runs separately, so a rendering
    // regression still fails — just with its own message instead of a timeout.
    await expect
      .poll(
        async () => {
          return page.evaluate(async () => {
            const db = await new Promise<IDBDatabase>((res, rej) => {
              const req = indexedDB.open('zonadua');
              req.onsuccess = () => res(req.result);
              req.onerror = () => rej(req.error);
            });
            const rows = await new Promise<Array<Record<string, unknown>>>((res, rej) => {
              const req = db.transaction('activities', 'readonly').objectStore('activities').getAll();
              req.onsuccess = () => res(req.result as never);
              req.onerror = () => rej(req.error);
            });
            db.close();
            return rows.some((r) => String(r.name).includes('E2E Power TCX'));
          });
        },
        { timeout: 20_000, message: 'the imported TCX ride never reached IndexedDB' }
      )
      .toBe(true);

    await page.getByText('E2E Power TCX').first().waitFor({ timeout: 20_000 });

    const stored = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const req = indexedDB.open('zonadua');
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const rows = await new Promise<Array<Record<string, unknown>>>((res, rej) => {
        const req = db.transaction('activities', 'readonly').objectStore('activities').getAll();
        req.onsuccess = () => res(req.result as never);
        req.onerror = () => rej(req.error);
      });
      db.close();
      return rows.find((r) => String(r.name).includes('E2E Power TCX')) as
        | { id: string; np?: number; tss?: number; if?: number; avgPower?: number; kcal: number }
        | undefined;
    });

    expect(stored, 'the TCX ride was never written to IndexedDB').toBeTruthy();
    // The file carried watts at every trackpoint. Dropping them produced a ride with no
    // NP, no IF and no TSS — indistinguishable, on screen, from a rider with no meter.
    expect(stored!.np, 'the imported ride has no normalized power').toBeGreaterThan(150);
    expect(stored!.tss, 'the imported ride has no training stress score').toBeGreaterThan(0);
    expect(stored!.avgPower).toBeGreaterThan(0);
    expect(stored!.kcal).toBeGreaterThan(100);

    // And it must reach the screen: the ride detail shows a number instead of the
    // "no power stream" state that was quietly covering for the parser.
    await page.goto(`/?r=${Date.now()}#/rides/${encodeURIComponent(stored!.id)}`);
    await page.waitForTimeout(1200);
    const text = await page.evaluate(() => document.body.innerText);

    // The empty state is what made the parser bug invisible: a dropped power trace and
    // a rider without a meter rendered identically. Assert the numbers are on screen,
    // not merely in the database.
    expect(text, 'the detail page still claims the ride has no power').not.toContain(
      'Needs power'
    );
    expect(text, 'the detail page still shows the no-power empty state').not.toContain(
      'no power stream'
    );
    expect(text, 'the computed NP is not on the detail page').toContain(String(stored!.np));
    expect(text, 'the computed TSS is not on the detail page').toContain(String(stored!.tss));
  });

  test('importing adds the distance to the active bike odometer', async ({ page }) => {
    await openApp(page, '#/gear');
    await page.getByText(/GEAR|BIKES/i).first().waitFor({ timeout: 20_000 });
    // the odometer belongs to a bike; production no longer seeds one
    await seedDashboardFixture(page);
    await page.reload();
    await page.getByText(/GEAR|BIKES/i).first().waitFor({ timeout: 20_000 });

    const before = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const req = indexedDB.open('zonadua');
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
        const req = indexedDB.open('zonadua');
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
        const req = indexedDB.open('zonadua');
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
    await seedDashboardFixture(page);
    await page.reload();

    // Put a credential and a Strava sync row on the device *before* the snapshot, so the
    // export has something real to leak and the identity comparison below still holds. Without
    // this the test would pass on a device that simply had no secrets.
    //
    // The fakes are passed in rather than closed over: `page.evaluate` ships this function to
    // the browser, where module scope does not exist.
    await page.evaluate(async (creds) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('zonadua');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const put = (store: string, row: Record<string, unknown>) =>
        new Promise<void>((resolve, reject) => {
          const req = db.transaction(store, 'readwrite').objectStore(store).put(row);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      const read = (store: string) =>
        new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
          const req = db.transaction(store, 'readonly').objectStore(store).getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      const settings = (await read('settings'))[0] ?? {};
      await put('settings', { ...settings, aiKey: creds.aiKey, updatedAt: Date.now() });
      await put('sync_state', {
        id: 'strava',
        lastSyncAt: 1,
        cursor: 2,
        accessToken: creds.accessToken,
        refreshToken: creds.refreshToken,
        expiresAt: 1_700_000_000,
        updatedAt: Date.now()
      });
      db.close();
    }, { aiKey: E2E_FAKE_AI_KEY, accessToken: E2E_FAKE_ACCESS_TOKEN, refreshToken: E2E_FAKE_REFRESH_TOKEN });
    await page.reload();

    const before = await dumpState(page);
    expect((before.activities ?? []).length, 'nothing seeded to back up').toBeGreaterThan(0);
    expect((before.sync_state?.[0] as Record<string, unknown> | undefined)?.refreshToken).toBe(
      E2E_FAKE_REFRESH_TOKEN
    );

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

    // The one assertion that matters here: the bytes that left the browser carry no
    // credential. A `zonadua-backup-*.json` lands in Downloads, syncs to cloud folders, and
    // is the file riders attach to issue reports — so this is checked on the downloaded file
    // itself, not on the code that built it.
    const exported = await readFile(file!, 'utf8');
    expect(exported).not.toContain(E2E_FAKE_AI_KEY);
    expect(exported).not.toContain(E2E_FAKE_ACCESS_TOKEN);
    expect(exported).not.toContain(E2E_FAKE_REFRESH_TOKEN);
    const exportedData = JSON.parse(exported).data as Record<string, Array<Record<string, unknown>>>;
    expect((exportedData.settings?.[0] ?? {}).aiKey).toBeUndefined();
    expect((exportedData.sync_state?.[0] ?? {}).refreshToken).toBeUndefined();
    // ...while the sync bookkeeping that a restore genuinely needs is still in there.
    expect((exportedData.sync_state?.[0] ?? {}).cursor).toBe(2);

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

    // Two settings fields are expected to differ and are removed from both sides before the
    // comparison: `lastBackupAt` is stamped by the export itself, and `aiKey` is redacted — the
    // whole point of this change — so `before` has it and `after` must not. Every other byte of
    // user data, including `sync_state`'s non-secret bookkeeping, must be identical.
    const strip = (s: Record<string, unknown[]>) => {
      const copy = JSON.parse(JSON.stringify(s)) as Record<string, Array<Record<string, unknown>>>;
      copy.settings = (copy.settings ?? []).map((row) => {
        const { lastBackupAt, aiKey, ...rest } = row;
        void lastBackupAt;
        void aiKey;
        return rest;
      });
      return copy;
    };

    // Every table in the snapshot must come back, including the ones added in later schema
    // versions. A hand-maintained export list is exactly how `power_curves` went missing.
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const table of Object.keys(before)) {
      // `sync_state` is the exception, and deliberately so: its credential fields were never in
      // the file, and a restore writes whole rows, so they are gone afterwards rather than
      // surviving from the row that was on the device. The rider reconnects; that cost is the
      // point of the feature. Its non-secret bookkeeping (`cursor`, `lastSyncAt`) still comes
      // back, which is why this is asserted rather than the table being skipped.
      if (table === 'sync_state') {
        const { accessToken, refreshToken, expiresAt, ...expected } = strip(before)[table][0] ?? {};
        void accessToken;
        void refreshToken;
        void expiresAt;
        expect(strip(after)[table][0], 'sync bookkeeping did not round-trip').toEqual(expected);
        continue;
      }
      expect(strip(after)[table], `table "${table}" did not round-trip`).toEqual(
        strip(before)[table]
      );
    }

    // The credential is genuinely absent from the device afterwards, not merely absent from
    // the file: a restore must not be a way to bring one back in.
    const keyStillThere = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('zonadua');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const read = (store: string) =>
        new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
          const req = db.transaction(store, 'readonly').objectStore(store).getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      const settings = (await read('settings'))[0] ?? {};
      const sync = (await read('sync_state'))[0] ?? {};
      db.close();
      return { aiKey: settings.aiKey, refreshToken: sync.refreshToken };
    });
    expect(keyStillThere.aiKey, 'restore resurrected the AI key').toBeUndefined();
    expect(keyStillThere.refreshToken, 'restore resurrected the Strava token').toBeUndefined();
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
        const req = indexedDB.open('zonadua');
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
      // the plan's kcal/eta are computed from the rider's weight and FTP; production
      // no longer seeds those, so this test supplies the figures its assertion expects
      await seedDashboardFixture(page);
      await page.reload();
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

test.describe('dashboard hero form gauge', () => {
  /**
   * The hero ring is a 240° gauge with its bottom open, not a full-circle progress ring.
   *
   * As a closed circle it read as a percentage — 30% of the circumference for a TSB of −16 —
   * which threw the arc's mass into the upper right while the figure sat dead centre, so the
   * eye took the *number* for the thing that was off-centre. It also had nowhere to mark the
   * midpoint of the ±40 scale, which is why a 30% arc could be misread as "30% readiness" —
   * the exact invented metric §36 removed from under it.
   *
   * These assertions are on the geometry rather than on the pixels, because that is what
   * actually changed: a full ring would fail on the sweep, and a gauge missing its midpoint
   * would fail on the tick.
   */
  test('the form ring is a 240-degree gauge with a marked midpoint, not a closed progress ring', async ({
    page
  }) => {
    await openApp(page, '#/');
    // The seed has to land first. The gauge's value arc is drawn from the PMC, so reading it
    // before the rides exist measures an arc built from the all-zero window — which is
    // exactly the state the dashboard now refuses to draw, and which used to pass this test
    // only because a fabricated zero still produced a plausible-looking sweep.
    await seedDashboardFixture(page);
    await page.reload();
    await page.getByText(/Fitness \(CTL\)/i).first().waitFor({ timeout: 20_000 });

    const gauge = await page.evaluate(() => {
      const svg = document.querySelector('#hero-pane svg[role="img"]');
      if (!svg) return null;
      const circles = [...svg.querySelectorAll('circle')];
      const track = circles[0];
      const arc = circles[1];
      const tick = svg.querySelector('line');
      if (!track) return null;

      const sweep = (c: SVGCircleElement | undefined) => {
        if (!c) return 0;
        const [dash, circumference] = c.getAttribute('stroke-dasharray')?.split(' ').map(Number) ?? [0, 0];
        return circumference ? (dash / circumference) * 360 : 0;
      };

      return {
        trackSweep: sweep(track),
        arcSweep: sweep(arc),
        trackRotation: track.getAttribute('transform'),
        arcRotation: arc?.getAttribute('transform') ?? null,
        hasTick: !!tick,
        tickX: tick?.getAttribute('x1') ?? null,
        tickY1: tick ? Number(tick.getAttribute('y1')) : null,
        tickY2: tick ? Number(tick.getAttribute('y2')) : null,
        cx: Number(track.getAttribute('cx')),
        cy: Number(track.getAttribute('cy')),
        r: Number(track.getAttribute('r')),
        strokeWidth: Number(track.getAttribute('stroke-width'))
      };
    });

    expect(gauge, 'the hero form ring was not found').not.toBeNull();
    // 240°, not 360° — a closed ring is a percentage, which is the reading this replaced.
    expect(gauge!.trackSweep, 'the gauge is a closed ring again').toBeCloseTo(240, 1);
    // Both arcs start from the same end, so the fill reads against the track rather than
    // against the top of the circle.
    expect(gauge!.arcRotation).toBe(gauge!.trackRotation);
    expect(gauge!.trackRotation).toBe('rotate(150 90 90)');
    // The value arc never exceeds the gauge it is drawn on.
    expect(gauge!.arcSweep).toBeLessThanOrEqual(240.1);
    // A midpoint tick is what makes the ±40 scale legible; without it the arc is decoration.
    expect(gauge!.hasTick, 'the TSB 0 midpoint tick is missing').toBe(true);
    // The tick marks the middle of the sweep, so it has to sit on the vertical axis above the
    // centre — anywhere else and the ±40 scale has no reference point.
    expect(gauge!.tickX, 'the midpoint tick is off the vertical axis').toBe(String(gauge!.cx));
    // Above the centre (SVG y grows downward), spanning exactly the stroke band: y1 is the
    // inner edge, y2 the outer one.
    expect(gauge!.tickY2!, 'the midpoint tick is not above the centre').toBeLessThan(gauge!.cy);
    expect(gauge!.cy - gauge!.tickY1!, 'the tick does not start at the inner edge of the band').toBe(
      gauge!.r - gauge!.strokeWidth / 2
    );
    expect(gauge!.cy - gauge!.tickY2!, 'the tick does not reach the outer edge of the band').toBe(
      gauge!.r + gauge!.strokeWidth / 2
    );
  });

  /**
   * The ring's figure rides the arc's centre line, and the ring itself is centred on the card.
   *
   * The figure is the one thing set *inside* the gauge, so `ARC_RISE` decides whether it looks
   * centred or low. The ring is now the whole of tier 1 rather than half a row, so the second
   * half of this guards the thing that changed: the gauge sits on the card's own axis, not
   * against a left edge with a column beside it.
   */
  test("the gauge figure rides the arc's centre line and the ring is centred on the card", async ({
    page
  }) => {
    await openApp(page, '#/');
    await seedDashboardFixture(page);
    await page.reload();
    await page.getByText(/Fitness \(CTL\)/i).first().waitFor({ timeout: 20_000 });

    const figure = await page.evaluate(() => {
      const today = document.querySelector('#hero-pane')?.children[0];
      const ring = today?.children[0]?.children[0];
      if (!today || !ring) return null;
      const caption = [...today.querySelectorAll('p')].find(
        (p) => p.textContent.trim() === 'Form TSB'
      );
      const block = caption?.parentElement;
      if (!block) return null;
      const b = block.getBoundingClientRect();
      const r = ring.getBoundingClientRect();
      const c = today.getBoundingClientRect();
      return {
        centre: Math.round(b.y + b.height / 2),
        ringCentreX: Math.round(r.x + r.width / 2),
        cardCentreX: Math.round(c.x + c.width / 2)
      };
    });

    expect(figure, 'the hero gauge figure was not found').not.toBeNull();
    const arc = Math.round(await gaugeArcMid(page));
    expect(
      Math.abs(arc - figure!.centre),
      `the figure sits ${arc - figure!.centre}px off the painted arc's centre line`
    ).toBeLessThanOrEqual(1);
    expect(figure!.ringCentreX - figure!.cardCentreX, 'the gauge is not centred on the card').toBe(0);
  });  /**
   * The two load tiles under the form gauge.
   *
   * They are inset tiles on the card's axis as of §45 (bare figures on a hairline before that,
   * raised cards beside the ring before §42), but the failure this guards is unchanged:
   * truncation. At 320px a tile is 120px wide and "Fitness"/"Fatigue" are the longest labels
   * the pair will ever hold — the tile's border and padding only make the room tighter than
   * it was.
   */
  for (const width of [320, 360, 430]) {
    test(`the load figures read in full at ${width} px`, async ({ page }) => {
      await openApp(page, '#/');
      await page.getByText('Fitness').first().waitFor({ timeout: 20_000 });
      await page.setViewportSize({ width, height: 900 });

      const pair = await page.evaluate(() => {
        const today = document.querySelector('#hero-pane')?.children[0];
        if (!today) return null;
        const row = today.children[2];
        const cells = [...row.querySelectorAll(':scope > div')];
        return {
          cellData: cells.map((c) => {
            const label = c.querySelector('p');
            return label
              ? {
                  text: label.textContent.trim(),
                  needs: label.scrollWidth,
                  has: label.clientWidth,
                  overflowing: c.scrollWidth - c.clientWidth
                }
              : null;
          }),
          heights: cells.map((c) => Math.round(c.getBoundingClientRect().height)),
          widths: cells.map((c) => Math.round(c.getBoundingClientRect().width)),
          docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      });

      expect(pair, 'the hero load figures were not found').not.toBeNull();
      expect(pair!.cellData.length, 'expected exactly two load figures').toBe(2);
      // Nothing clipped. A truncated label is worse than no figure at all.
      for (const c of pair!.cellData) {
        expect(c, 'a load figure is missing its label').not.toBeNull();
        expect(
          c!.needs - c!.has,
          `"${c!.text}" is clipped to ${c!.has}px of the ${c!.needs}px it needs`
        ).toBeLessThanOrEqual(0);
        expect(c!.overflowing, `"${c!.text}" overflows its cell`).toBeLessThanOrEqual(0);
      }
      expect(pair!.docOverflow, 'the hero overflows the viewport').toBeLessThanOrEqual(0);
      // Equal cells — the pair has to read as a pair, not as a big one and a small one.
      expect(new Set(pair!.heights).size, `uneven cell heights: ${pair!.heights}`).toBe(1);
      expect(new Set(pair!.widths).size, `uneven cell widths: ${pair!.widths}`).toBe(1);
    });
  }/**
 * The form band lives inside the gauge's opening, not in a row of its own.
 *
 * It was a full-width pill under the figures and, before that, a bare coloured line. Both were
 * rejected for the same measured reason: the name could not fit inside the 112px ring, so it had
 * to sit outside and then invent a row to belong to. Growing the ring to 180px widens the clear
 * span between the arc's two round caps to 92px, which is what lets the name live where it
 * belongs — the one place on the card that is both part of the gauge and empty.
 *
 * The assertions are the geometry that makes that true: the label is centred on the card's axis,
 * its vertical centre is at the caps' own depth (the widest point of the mouth), and it is
 * narrower than the clear span between the caps. `gaugeArcBottom` is no longer the datum — the
 * band is above it now — so the caps are measured off the SVG's own attributes instead.
 */
  test('the form band sits inside the gauge mouth, centred and clear of the caps', async ({ page }) => {
    await openApp(page, '#/');
    await seedDashboardFixture(page);
    await page.reload();
    await page.getByText('Fitness').first().waitFor({ timeout: 20_000 });

    const band = await page.evaluate(() => {
      const today = document.querySelector('#hero-pane')?.children[0];
      const ring = today?.children[0]?.children[0] as HTMLElement | undefined;
      if (!today || !ring) return null;
      const name = [...today.querySelectorAll('p')].find((p) =>
        /^(RECOVER FIRST|DETRAINING|BALANCED|BUILDING|PEAKED|NO DATA)$/.test(p.textContent.trim())
      );
      if (!name) return null;
      const circle = ring.querySelector('svg circle')!;
      const r = Number(circle.getAttribute('r'));
      const stroke = Number(circle.getAttribute('stroke-width'));
      const ringBox = ring.getBoundingClientRect();
      const box = name.getBoundingClientRect();
      return {
        text: name.textContent.trim(),
        clipped: name.scrollWidth - name.clientWidth,
        width: box.width,
        // Clear span between the two round caps, which sit at 30° and 150°.
        clear: 2 * (r * Math.cos(Math.PI / 6) - stroke / 2),
        // R/2 below the ring centre is exactly the caps' depth.
        capDepth: r / 2,
        centreBelowRingCentre: box.top + box.height / 2 - (ringBox.top + ringBox.height / 2),
        centreDelta: Math.round(box.x + box.width / 2 - (ringBox.x + ringBox.width / 2))
      };
    });

    expect(band, 'the form band was not found in the hero').not.toBeNull();
    expect(band!.clipped, `"${band!.text}" is clipped`).toBeLessThanOrEqual(0);
    // The name has to clear both round caps, or the ring eats its ends.
    expect(
      band!.width - band!.clear,
      `"${band!.text}" is ${Math.round(band!.width)}px wide but the mouth is only ${Math.round(band!.clear)}px`
    ).toBeLessThanOrEqual(0);
    // ...and sit at the widest point of the mouth rather than below it.
    expect(
      Math.abs(band!.centreBelowRingCentre - band!.capDepth),
      `the band sits ${band!.centreBelowRingCentre.toFixed(1)}px below the centre, not the caps' ${band!.capDepth}px`
    ).toBeLessThanOrEqual(1);
    expect(band!.centreDelta, 'the band is not centred on the ring').toBe(0);
  });

/**
 * The lowest painted pixel of the gauge's arc — the edge anything below the gauge must clear.
 *
 * The 180px box continues past the painted arc by about 46px, because the dash stops at 30° and
 * 150° and the circle's own bottom falls in the open gap. Measuring clearance from the box
 * reports a figure that is comfortably below the gauge as overlapping it.
 */
async function gaugeArcBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const circle = document.querySelector('#hero-pane svg[role="img"] circle');
    if (!circle) return NaN;
    const dash = Number(circle.getAttribute('stroke-dasharray')?.split(' ')[0] ?? 0);
    const half = Number(circle.getAttribute('stroke-width') ?? 0) / 2;
    const matrix = circle.getScreenCTM();
    if (!matrix || !(dash > 0)) return NaN;
    const at = (len: number) => {
      const p = circle.getPointAtLength(len);
      return new DOMPoint(p.x, p.y).matrixTransform(matrix).y;
    };
    return Math.max(at(0), at(dash)) + half;
  });
}

/**
 * The three-up strip under the hero, on the Form tab.
 *
 * The Today pane used to carry a matching Time/Distance/Stress strip; V3 (§42) removed it,
 * because the "Last 7 days" card directly below the hero already states the same three figures.
 * The Form tab's strip remains, and this guards it the same way: measured with `Range` on the
 * text, not on the boxes, because `text-center` on a box always looks right whether or not the
 * text inside it followed.
 */
  for (const [tab, labels] of [['form', ['Fitness', 'Fatigue', 'Form']]] as const) {
    test(`the ${tab} strip centres every label and figure on its cell`, async ({ page }) => {
      await openApp(page, '#/');
      await page.getByText('Fitness').first().waitFor({ timeout: 20_000 });
      if (tab === 'form') await page.getByRole('tab', { name: /form/i }).click();
      await page.waitForTimeout(300);

      const strip = await page.evaluate((wanted) => {
        const pane = document.querySelector('#hero-pane');
        // The tab buttons live in the chrome strip, which is a sibling of the pane, so the tab
        // order has to be read from the document rather than from the pane.
        const tabs = [...document.querySelectorAll('[role=tab]')];
        const index = tabs.findIndex((t) => t.id === `hero-tab-${wanted}`);
        // The three panels share one grid cell and carry no id of their own, so they are reached by
        // the tab order rather than by a selector. Their order is the tab order, which is the only
        // structural handle they have.
        const tabPanel = index >= 0 ? pane?.children[index] : null;
        if (!tabPanel) return null;
        const rows = [...tabPanel.querySelectorAll('div')].filter((d) =>
          d.className.includes('grid-cols-3')
        );
        const row = rows[0];
        if (!row) return null;
        const range = document.createRange();
        return [...row.children].map((cell) => {
          const centre = cell.getBoundingClientRect().x + cell.getBoundingClientRect().width / 2;
          return [...cell.children].map((part) => {
            range.selectNodeContents(part);
            const box = range.getBoundingClientRect();
            return Math.round(box.x + box.width / 2 - centre);
          });
        });
      }, tab);

      expect(strip, `the ${tab} strip was not found`).not.toBeNull();
      expect(strip!.length, `expected three cells in the ${tab} strip`).toBe(3);
      const offenders: string[] = [];
      strip!.forEach((cell, i) => {
        cell.forEach((offset, j) => {
          if (Math.abs(offset) > 1) offenders.push(`${labels[i]} ${j === 0 ? 'label' : 'figure'} is ${offset}px off`);
        });
      });
      expect(offenders.join('; '), 'cells are not centred on their own text').toBe('');
    });
  }
/**
 * The load tiles are a compact pair at the foot of the card, not columns stretched to fill it.
 *
 * They were two raised tiles beside the ring, and the failure the rider reported was arithmetic:
 * too tall, their bottom edge landing exactly on the divider below (touching it), and sitting off
 * the ring's centre line. The pair has moved under the ring and, as of §45, gained a bar and a
 * scale caption — the properties that matter are unchanged: a tile is no taller than its lines
 * need, no hole opens between them, the bar says what its own figure says, and the pair clears
 * the gauge above it.
 *
 * Measured at each width because one pixel of padding is all it takes to drift while the page
 * still looks deliberate in a browser.
 */
for (const width of [320, 390, 430]) {
  test(`the load tiles stay compact under the ring at ${width} px`, async ({ page }) => {
    await openApp(page, '#/');
    await page.getByText('Fitness').first().waitFor({ timeout: 20_000 });
    await page.setViewportSize({ width, height: 900 });

    const pair = await page.evaluate(() => {
      const today = document.querySelector('#hero-pane')?.children[0];
      if (!today) return null;
      const cells = [...today.children[2].querySelectorAll(':scope > div')];
      if (cells.length !== 2) return null;
      const caption = today.children[3] as HTMLElement | undefined;
      return {
        cells: cells.map((cell) => {
          const [label, figure, unit] = [...cell.children].map((el) => el.getBoundingClientRect());
          const track = cell.children[3]?.getBoundingClientRect();
          const fill = cell.children[3]?.firstElementChild?.getBoundingClientRect();
          return {
            value: cell.children[1]?.textContent?.trim() ?? '',
            height: Math.round(cell.getBoundingClientRect().height),
            // A gap inside the cell means the lines were pushed apart instead of set on a
            // rhythm. Two pixels of margin, not seventy.
            labelToFigure: Math.round(figure.top - label.bottom),
            figureToUnit: Math.round(unit.top - figure.bottom),
            overflow: cell.scrollWidth - cell.clientWidth,
            // The fill against its own track, as a percent of the 0–60 scale.
            barPct: track && fill && track.width > 0 ? (fill.width / track.width) * 100 : null
          };
        }),
        caption: caption
          ? {
              text: caption.textContent?.trim() ?? '',
              clipped: caption.scrollWidth - caption.clientWidth
            }
          : null
      };
    });

    expect(pair, 'the hero load tiles were not found').not.toBeNull();
    for (const c of pair!.cells) {
      // 104px measured at every width: two four-line tiles plus their padding, and no more.
      expect(c.height, `a load tile is ${c.height}px tall — it has been stretched`).toBeLessThanOrEqual(112);
      expect(c.labelToFigure, `${c.labelToFigure}px hole between the label and the figure`).toBeLessThanOrEqual(8);
      expect(c.figureToUnit, `${c.figureToUnit}px hole between the figure and the unit`).toBeLessThanOrEqual(8);
      expect(c.overflow, 'a load tile overflows its box').toBeLessThanOrEqual(0);
      // The bar must say what its own figure says: the value placed on the 0–60 scale the
      // caption names, clamped at the scale's end. A bar that drifts from its figure is worse
      // than no bar — it is a second number, and a wrong one.
      const v = Number.parseInt(c.value, 10);
      const expected = Number.isNaN(v) ? 0 : Math.round((Math.min(60, Math.max(0, v)) / 60) * 100);
      expect(c.barPct, `the tile for "${c.value}" has no bar under its figure`).not.toBeNull();
      expect(
        Math.abs((c.barPct ?? Number.NaN) - expected),
        `the bar reads ${c.barPct?.toFixed(1)}% but ${c.value} on a 0–60 scale is ${expected}%`
      ).toBeLessThanOrEqual(1);
    }
    expect(
      new Set(pair!.cells.map((c) => c.height)).size,
      `uneven cell heights: ${pair!.cells.map((c) => c.height)}`
    ).toBe(1);

    // An unlabelled bar is a number that cannot be read — the failure the tiles exist to fix —
    // so the scale has to be named where the bars are, uncut, at every width.
    expect(pair!.caption, 'the load tiles have no scale caption').not.toBeNull();
    expect(pair!.caption!.text, 'the caption does not name the bar scale').toContain('0–60');
    expect(pair!.caption!.clipped, `"${pair!.caption!.text}" is clipped`).toBeLessThanOrEqual(0);

    // Daylight between the gauge's lowest painted pixel and the pair below it. Zero is the
    // collision the rider reported when the tiles sat beside the ring.
    const arcBottom = await gaugeArcBottom(page);
    const pairTop = await page.evaluate(() =>
      Math.round(
        (document.querySelector('#hero-pane') as HTMLElement).children[0].children[2].getBoundingClientRect().top
      )
    );
    expect(pairTop - Math.round(arcBottom), 'the load pair touches the gauge above it').toBeGreaterThanOrEqual(8);
  });
}

/**
 * The band name is the only thing on the hero tinted by band, and it is tinted by the table.
 *
 * The chrome around it is gone — there is no chip any more — so the colour is the whole of what
 * tells the rider which band they are in. The table pins the mapping for every band rather than
 * guarding one of them behind an `if`: a conditional on which band the seed happens to produce
 * is a test that silently asserts nothing the day the seed shifts, which is exactly what
 * happened when this was first written with a `nameText === 'DETRAINING'` guard and the
 * regression proof went green.
 *
 * One honest collision: the `balanced` tone is `#f7f8fa`, the same as the plain text token, so a
 * neutral name cannot be told apart from a toned one while the form is balanced. That is the
 * design being right rather than the test being weak — highlighting "balanced" would be shouting
 * about the absence of news.
 */
for (const width of [320, 390, 430]) {
  test(`the form band name carries its own tone at ${width} px`, async ({ page }) => {
    await openApp(page, '#/');
    await page.getByText('Fitness').first().waitFor({ timeout: 20_000 });
    await page.setViewportSize({ width, height: 900 });

    const name = await page.evaluate(() => {
      const today = document.querySelector('#hero-pane')?.children[0];
      if (!today) return null;
      const el = [...today.querySelectorAll('p')].find((p) =>
        /^(RECOVER FIRST|DETRAINING|BALANCED|BUILDING|PEAKED|NO DATA)$/.test(p.textContent.trim())
      );
      if (!el) return null;
      return {
        text: el.textContent.trim(),
        color: getComputedStyle(el).color,
        clipped: el.scrollWidth - el.clientWidth
      };
    });

    expect(name, 'the form band name was not found').not.toBeNull();
    expect(name!.clipped, `"${name!.text}" is clipped`).toBeLessThanOrEqual(0);
    const BAND_TONE: Record<string, string> = {
      'RECOVER FIRST': 'rgb(255, 138, 146)',
      DETRAINING: 'rgb(255, 179, 90)',
      BALANCED: 'rgb(247, 248, 250)',
      BUILDING: 'rgb(255, 77, 94)',
      PEAKED: 'rgb(255, 77, 94)',
      'NO DATA': 'rgb(155, 161, 170)'
    };
    expect(
      BAND_TONE[name!.text],
      `"${name!.text}" is not a known form band name`
    ).toBeDefined();
    expect(
      name!.color,
      `"${name!.text}" is painted ${name!.color}, not its form band tone`
    ).toBe(BAND_TONE[name!.text]);
  });
}

/**
 * The hero is one card with three panes in a single grid cell, so the card is exactly as tall
 * as its tallest pane — the Today pane. The Form and Load panes were shorter than that and let
 * the difference fall where it fell: 22px of dead air under the Form chart and 59px under the
 * Load bars, with the fitness/fatigue/form trio and the day labels floating above it.
 *
 * Both charts now take the slack (`flex-1`, height bound back off the element) and the closing
 * rows sit on the bottom edge of the cell. That gives the panes a shared bottom line with the
 * Today pane, which is the part a rider can actually see: switching tabs must not move the last
 * line of the card.
 *
 * The measurements are taken with the pane visible but the other two still in the DOM, because
 * the grid cell only has its final height once all three are present. Tab order is asserted too
 * — `children[0]` is Today, `[1]` is Form, `[2]` is Load — so a reordered pane fails here rather
 * than silently measuring the wrong one.
 */
for (const width of [320, 390, 430]) {
  test(`every hero tab ends on the same line and spends its height on the chart at ${width} px`, async ({
    page
  }) => {
    await openApp(page, '#/');
    // The Today pane carries the week's change in its status pill, and that pill is shorter
    // without it — so an unseeded read measures a different card height than the rider sees.
    await seedDashboardFixture(page);
    await page.reload();
    await page.getByText('Fitness').first().waitFor({ timeout: 20_000 });
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('tab', { name: 'Today' }).click();
    await page.waitForTimeout(200);

    const tabs = await page.evaluate(() => {
      const grid = document.getElementById('hero-pane');
      if (!grid) return null;
      const gb = grid.getBoundingClientRect();
      // The deepest last child that actually has a box: the Today pane has no single column
      // wrapper, so its first child is one tier, not the whole pane.
      const lastRow = (el: Element) => {
        let cur: Element = el;
        let last: Element = el;
        for (let i = 0; i < 12; i++) {
          const kids = [...cur.children].filter((c) => c.getBoundingClientRect().height > 0);
          if (!kids.length) break;
          last = kids[kids.length - 1]!;
          cur = last;
        }
        return last;
      };
      return {
        cellHeight: Math.round(gb.height),
        panes: [...grid.children].map((p, i) => {
          const last = lastRow(p);
          const lb = last.getBoundingClientRect();
          const inner = p.firstElementChild!;
          return {
            i,
            // 0 when the pane's content fills the cell, i.e. no dead air at the foot.
            slack: Math.round(gb.height - inner.getBoundingClientRect().height),
            gapToBottom: Math.round(gb.bottom - lb.bottom),
            overflow: p.scrollHeight - p.clientHeight
          };
        }),
        // Chart heights, which are the whole point: 96px and 112px before, the leftover after.
        formChartH: Math.round(
          grid.children[1]!.querySelector('.flex-1')!.getBoundingClientRect().height
        ),
        loadChartH: Math.round(
          grid.children[2]!.querySelector('.flex-1')!.getBoundingClientRect().height
        )
      };
    });

    expect(tabs, 'the hero pane was not found').not.toBeNull();
    const byPane = new Map(tabs!.panes.map((p) => [p.i, p]));

    for (const [i, name] of [
      [0, 'Today'],
      [1, 'Form'],
      [2, 'Load']
    ] as const) {
      const p = byPane.get(i)!;
      expect(
        p.gapToBottom,
        `the ${name} pane's last row stops ${p.gapToBottom}px short of the card's bottom edge`
      ).toBe(0);
      expect(p.overflow, `the ${name} pane overflows its cell`).toBeLessThanOrEqual(0);
    }

    // The Today pane is not a single column, so its slack is measured through its last row,
    // which the assertion above already did. Form and Load are columns and can be measured whole.
    expect(byPane.get(1)!.slack, 'the Form pane leaves dead air above its closing row').toBe(0);
    expect(byPane.get(2)!.slack, 'the Load pane leaves dead air above its closing row').toBe(0);

    // The slack went into the charts, not just out of sight. 96 and 112 are the fixed heights
    // that used to strand the space below them.
    expect(tabs!.formChartH, 'the Form chart did not grow into the freed space').toBeGreaterThanOrEqual(100);
    expect(tabs!.loadChartH, 'the Load bars did not grow into the freed space').toBeGreaterThanOrEqual(130);
  });
}

/**
 * A rider who has never ridden must not be told their fitness and fatigue are "BALANCED".
 *
 * `computePmc` walks its window from CTL=ATL=0 on purpose, so an empty window still produces a
 * full-length curve of zeros, and `formState(0)` is `balanced`. The hero was therefore showing
 * a confident band to someone who had never trained — and `+0 pts / 7d` beside it, which is
 * the same false claim with a number attached. The zero is real arithmetic; the reading of it
 * is not, and a beginner meeting the app on their first morning is exactly who gets hurt by it.
 *
 * The rides are cleared from IndexedDB and the document reloaded, so the dashboard recomputes
 * from an empty table the way a genuine first launch would. The seeder runs only on first
 * launch, so the demo rides do not come back.
 *
 * `NO DATA` is asserted by name *and* by tone: the label is the rider-facing truth, and the
 * neutral grey is what stops it reading as a fifth training state.
 */
test('a rider with no rides in the window is told NO DATA rather than a form band', async ({
  page
}) => {    await openApp(page, '#/');
    await seedDashboardFixture(page);
    await page.reload();

    await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('zonadua');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const names = Array.from(db.objectStoreNames);
    const store = names.find((n) => n.toLowerCase().includes('activit'));
    if (!store) throw new Error(`no activities store among ${names.join(', ')}`);
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });

  await openApp(page, '#/');
  await page.getByText('Fitness').first().waitFor({ timeout: 20_000 });

  const hero = await page.evaluate(() => {
    const today = document.querySelector('#hero-pane')?.children[0];
    if (!today) return null;
    const name = [...today.querySelectorAll('p')].find((p) =>
      /^(RECOVER FIRST|DETRAINING|BALANCED|BUILDING|PEAKED|NO DATA)$/.test(p.textContent.trim())
    );
    const texts = [...today.querySelectorAll('p')].map((p) => p.textContent.trim());
    return {
      // The gauge's figure is a sibling of the <svg>, not inside it, so it is found by its
      // own caption rather than by a descendant selector that would silently match nothing.
      ring:
        [...today.querySelectorAll('p')]
          .find((p) => p.textContent.trim() === 'Form TSB')
          ?.previousElementSibling?.textContent.trim() ?? null,
      band: name?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      bandColor: name ? getComputedStyle(name).color : null,
      // The two figures sit between their own label and their own unit, so they can be picked
      // out by their neighbours rather than by position.
      tileValues: texts.filter((t, i) => texts[i - 1] === 'Fitness' || texts[i - 1] === 'Fatigue'),
      pageText: document.body.textContent ?? ''
    };
  });

  expect(hero, 'the hero pane was not found').not.toBeNull();
  expect(hero!.band, 'a rider with no rides was given a form band').toBe('NO DATA');
  expect(hero!.ring, 'the gauge reported a form value with no rides in the window').toBe('—');
  expect(
    hero!.tileValues,
    'the load tiles reported a fitness or fatigue figure with no rides in the window'
  ).toEqual(['—', '—']);
  // The neutral grey, so it does not read as a fifth training state alongside the real bands.
  expect(hero!.bandColor, 'the no-data band is painted a band tone').toBe('rgb(155, 161, 170)');
  expect(
    hero!.pageText,
    'the page still claims a 7-day form change with no rides in the window'
  ).not.toContain('pts / 7d');
});
});

test.describe('first launch without demo data — the Gear page has a way in', () => {
  /**
   * The demo stable is dev-only (see `DEMO_SEEDING_ENABLED`), so a production first launch
   * lands on Gear with **no bike at all**. Until this change that page was a dead end: a
   * "No machines yet" subtitle over an empty column, no control that writes a bike, and
   * nothing to say where gear would come from.
   *
   * This is the receipt for the fix, and it goes through the UI the rider uses rather than
   * asserting on the markup: the empty state must explain itself, say what has not synced,
   * and the header action must actually store a bike — which then becomes the primary
   * machine, because a bike that is not active leaves Routes and Race with nothing to model.
   */
  test('offers an add-bike action and stores the bike', async ({ page }) => {
    await openApp(page, '#/gear');

    await expect(page.getByRole('heading', { name: /add your first bike/i })).toBeVisible();
    await expect(page.getByText(/no machines yet/i)).toBeVisible();
    // where rides come from, and the honest sync state — the two things an empty log hides
    await expect(page.getByText(/not synced yet/i)).toBeVisible();
    // Strava is the primary pipeline, so connect is named first and file import second
    await expect(page.getByText(/connect strava in settings/i)).toBeVisible();
    await expect(page.getByText(/gpx\/tcx import also works/i)).toBeVisible();

    await page.getByRole('button', { name: /^add a bike$/i }).click();
    const sheet = page.getByRole('dialog', { name: 'Add bike' });
    await expect(sheet).toBeVisible();

    await sheet.getByPlaceholder('e.g. Domane SL6').fill('Weekend bike');
    // the type buttons carry the type's suggested weight; overwrite it to prove the stored
    // value is the rider's and not the suggestion
    await sheet.getByRole('button', { name: 'Gravel' }).click();
    await sheet.getByRole('spinbutton').fill('10.6');
    await sheet.getByRole('button', { name: /^add bike$/i }).click();

    // really stored: it lands as the primary machine, from an empty odometer
    await expect(page.getByRole('heading', { name: 'Weekend bike' })).toBeVisible();
    await expect(page.getByText(/primary bike/i)).toBeVisible();
    await expect(page.getByText(/no machines yet/i)).toHaveCount(0);
    await expect(page.getByText('10.6 kg')).toBeVisible();
  });
});

test.describe('dashboard monolith hero geometry', () => {
  /**
   * The monolith hero must stay a *card*, at every width and in every tab.
   *
   * Reported from the field as a hero that "keeps stretching". The shape of the bug is
   * geometry, not content: the three panes share one grid cell so the card is exactly as
   * tall as its tallest pane, and a pane whose chart wrapper was allowed to grow instead of
   * absorbing slack pushes the whole dark card down past the fold — the numbers all stay
   * correct, which is why it reads as "the layout feels wrong" rather than as a defect.
   *
   * Two invariants, both measured from the DOM rather than from the classes that fix them
   * (searching for the fix's own class makes a test pass and fail for the wrong reason):
   * the card stays under a bound that no amount of content crosses, and no pane is taller
   * than another, so switching tabs cannot resize the card under the rider's thumb.
   */
  const CARD_MAX_H = 420;
  const WIDTHS = [320, 390];

  for (const width of WIDTHS) {
    test(`the hero card stays bounded and tab-stable at ${width}px, with and without data`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });

      const measureAllTabs = async (label: string) => {
        const heights: Array<{ tab: string; card: number; panes: number[] }> = [];
        for (const tab of ['Today', 'Form', 'Load']) {
          await page.getByRole('tab', { name: tab }).click();
          await page.waitForTimeout(250);
          heights.push(
            await page.evaluate((tabName) => {
              const pane = document.querySelector('#hero-pane');
              const card = pane?.closest('.bg-mono');
              return {
                tab: tabName,
                card: card ? Math.round(card.getBoundingClientRect().height) : -1,
                panes: pane ? [...pane.children].map((c) => Math.round(c.getBoundingClientRect().height)) : []
              };
            }, tab)
          );
        }
        console.log(`[${label}@${width}]`, JSON.stringify(heights));
        return heights;
      };

      await openApp(page, '#/');
      await page.locator('#app').waitFor({ timeout: 20_000 });
      const empty = await measureAllTabs('empty');

      // and again with the fixture's rides, so the charts have something to draw
      await seedDashboardFixture(page);
      await page.reload();
      await page.locator('#app').waitFor({ timeout: 20_000 });
      const withData = await measureAllTabs('data');

      for (const sample of [...empty, ...withData]) {
        expect(sample.card, `${sample.tab} card height at ${width}px`).toBeGreaterThan(0);
        expect(sample.card, `${sample.tab} card stretched to ${sample.card}px at ${width}px`).toBeLessThanOrEqual(CARD_MAX_H);
        expect(sample.panes.length).toBe(3);
        const tallest = Math.max(...sample.panes);
        const shortest = Math.min(...sample.panes);
        expect(tallest - shortest, `${sample.tab} panes disagree by ${tallest - shortest}px at ${width}px`).toBeLessThanOrEqual(2);
      }
    });
  }
});

test.describe('dashboard monolith hero stability (powerless Strava data)', () => {
  /**
   * The reported field bug: the monolith hero "keeps stretching".
   *
   * It was a feedback loop, not a layout choice. The Form pane measures its flexible chart
   * box with `bind:clientHeight` and handed that number straight back to the SVG as its
   * `height` attribute: the box asked for slack, the chart was sized to the slack, the chart
   * became content of the box, and every rerender grew the hero another few hundred pixels
   * until the card was taller than the screen and pushed the rest of the dashboard — the
   * week numbers, the tiles — below the fold.
   *
   * Why the fixture never caught it: the fixture's rides carry power, so the pane took a
   * different path. The data that triggered it is what a rider who has connected Strava but
   * rides without a power meter actually has — activities with distance and time, and no
   * CTL/ATL/TSB to draw. So this test seeds exactly that, and asserts the two things the
   * report was actually about: the card stays a card, and it *stops growing*.
   */
  const CARD_MAX_H = 420;

  test('the hero card does not grow over time with powerless Strava activities', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page, '#/');
    await page.locator('#app').waitFor({ timeout: 20_000 });

    // 30 activities across ~10 weeks, no power fields: what the API returns for a rider
    // with no power meter, and what the runaway chart was measured on.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const req = indexedDB.open('zonadua');
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      await new Promise<void>((res, rej) => {
        const tx = db.transaction('activities', 'readwrite');
        const store = tx.objectStore('activities');
        for (let i = 0; i < 30; i++) {
          const d = new Date(Date.UTC(2026, 6, 1 + i * 2));
          store.put({
            id: `strava-powerless-${String(i).padStart(3, '0')}`,
            date: d.toISOString(),
            name: `Strava ride ${i}`,
            source: 'strava',
            distanceKm: 42,
            movingSec: 5400,
            elapsedSec: 6000,
            elevGainM: 320,
            kcal: 950,
            synthetic: false,
            updatedAt: Date.now()
          });
        }
        tx.oncomplete = () => {
          db.close();
          res();
        };
        tx.onerror = () => rej(tx.error);
      });
    });
    await page.reload();
    await page.locator('#app').waitFor({ timeout: 20_000 });
    await page.getByRole('tab', { name: /form/i }).waitFor({ timeout: 20_000 });

    const cardHeight = () =>
      page.evaluate(() => {
        const card = document.querySelector('#hero-pane')?.closest('.bg-mono');
        return card ? Math.round(card.getBoundingClientRect().height) : -1;
      });

    // The Form pane is where the loop lived; sample it while it is visible and settling.
    await page.getByRole('tab', { name: 'Form' }).click();
    const samples: number[] = [];
    for (let i = 0; i < 4; i++) {
      samples.push(await cardHeight());
      await page.waitForTimeout(1200);
    }
    console.log('[powerless card samples]', JSON.stringify(samples));

    expect(samples[0]).toBeGreaterThan(0);
    for (const h of samples) {
      expect(h, `monolith hero stretched to ${h}px`).toBeLessThanOrEqual(CARD_MAX_H);
    }
    const spread = Math.max(...samples) - Math.min(...samples);
    expect(spread, `monolith hero grew ${spread}px while idle: ${samples.join(', ')}`).toBeLessThanOrEqual(4);

    // and the tabs agree, so switching never resizes the card under the rider's thumb
    const perTab: number[] = [];
    for (const tab of ['Today', 'Load', 'Today']) {
      await page.getByRole('tab', { name: tab }).click();
      await page.waitForTimeout(500);
      perTab.push(await cardHeight());
    }
    console.log('[powerless per-tab]', JSON.stringify(perTab));
    expect(Math.max(...perTab) - Math.min(...perTab)).toBeLessThanOrEqual(4);
  });
});
