import { defineConfig, devices } from '@playwright/test';

/**
 * E2E for the race cockpit (UI-SPEC §27).
 *
 * These run against the **preview build**, not the dev server: the thing that matters for
 * "does the offline PWA actually work offline" is the built output with its service worker
 * and minified bundles, and testing `vite dev` would quietly prove nothing about it.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Buffered output keeps the failure readable; a race run is a handful of assertions and
  // serialising them costs little next to the browser startup each one needs.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    // The cockpit renders clock times through `toLocaleTimeString` and `new Date()`. Pinning
    // the zone makes "05:30 roll-out" mean the same instant on every machine, so a test
    // cannot pass in Jakarta and fail in UTC.
    timezoneId: 'Asia/Jakarta',
    locale: 'en-GB'
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // `build:e2e` (mode `e2e`) strips `VITE_STRAVA_CLIENT_ID` even when a local .env.local has
    // one, so the "not configured" refusal in strava-connect.spec.ts stays testable on a
    // machine set up for live Strava testing.
    command: 'npm run build:e2e && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});