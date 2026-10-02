/**
 * Lighthouse audit — ROADMAP M0 DoD ("PWA ≥ 90, performa ≥ 90 di preview build").
 *
 * ## Why this is a script and not a number pasted into the roadmap
 *
 * The DoD line sat unticked for the whole life of M0, and the cheapest way to "close" it
 * would have been to run Lighthouse once by hand and type the result in. That number goes
 * stale the next time a dependency moves, and a stale score in a document reads exactly
 * like a live one. Running it from `npm run` makes the claim reproducible: anyone can re-run
 * it and get today's truth.
 *
 * ## Why it drives Playwright's Chromium rather than asking for Chrome on PATH
 *
 * Installing a second browser for an audit nobody runs often is a poor trade. Playwright's
 * Chromium is already pinned by `playwright.config.ts` and already downloaded, so the audit
 * measures the same engine the E2E suite runs on — one browser, one version, one place to
 * upgrade it.
 *
 * ## The thresholds are the DoD's, not mine
 *
 * `PERF_FLOOR` / `PWA_FLOOR` mirror the roadmap wording verbatim. Lowering them here to
 * make a run go green would move the goalposts without moving the app.
 *
 * ## Pinned to Lighthouse 11, not 12
 *
 * Lighthouse 12 dropped the PWA category entirely, so the M0 DoD ("Lighthouse PWA ≥ 90")
 * became unmeasurable rather than passing. The dependency stays on 11.x while that line is
 * on the board, and the script **fails loudly on a missing category** instead of scoring it
 * zero — a silent zero here would have read as "PWA 0, badly failing app" rather than "this
 * tool can no longer answer the question".
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import lighthouse from 'lighthouse';

const PORT = 4174;
const URL = `http://localhost:${PORT}/#/`;
const PERF_FLOOR = 90;
const PWA_FLOOR = 90;

/** Playwright's Chromium, wherever this machine happens to have unpacked it. */
function findChromium() {
  const root = join(process.env.LOCALAPPDATA ?? join(homedir(), '.cache'), 'ms-playwright');
  if (!existsSync(root)) return undefined;
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'));
  if (!dir) return undefined;
  const exe = join(root, dir, 'chrome-win64', 'chrome.exe');
  return existsSync(exe) ? exe : undefined;
}

/**
 * Launch Chromium with CDP on an OS-assigned port and report the port back.
 *
 * Port 0 means "pick one for me", which avoids colliding with a real browser the
 * developer already has open — a fixed 9222 would fail on a machine that happens to have
 * a debugging instance running, and fail *unhelpfully*.
 */
function launchCdpChrome(exe) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      exe,
      [
        '--headless=new',
        '--remote-debugging-port=0',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--user-data-dir=' + join(process.cwd(), '.lighthouse', 'profile'),
        'about:blank'
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let buf = '';
    const onData = (chunk) => {
      buf += String(chunk);
      const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(buf);
      if (m) {
        proc.stderr.off('data', onData);
        resolve({ port: Number(m[1]), proc });
      }
    };
    proc.stderr.on('data', onData);
    proc.on('error', reject);
    setTimeout(() => reject(new Error('Chromium never reported a DevTools port')), 30_000);
  });
}

/** Wait for the preview server to answer before pointing Lighthouse at it. */
async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(URL, { redirect: 'manual' });
      if (r.status > 0) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`preview server never came up on ${URL}`);
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  shell: true
});

let exitCode = 0;
let cdp = null;
try {
  await waitForServer();

  const chromePath = findChromium();
  if (!chromePath) throw new Error('Playwright Chromium not found — run npm run test:e2e:install');

  // Playwright gives no way to expose its remote-debugging port, and Lighthouse needs a
  // real CDP endpoint (it reads /json/version over HTTP). So Chromium is launched here with
  // `--remote-debugging-port=0` and the port it picks is read back off stderr.
  const launched = await launchCdpChrome(chromePath);
  cdp = launched.proc;
  const runnerResult = await lighthouse(URL, {
    port: launched.port,
    output: 'json',
    logLevel: 'error'
  });
  await cdp.kill();
  cdp = null;

  const lhr = runnerResult.lhr;
  const cats = Object.fromEntries(
    Object.entries(lhr.categories).map(([k, v]) => [k, Math.round((v.score ?? 0) * 100)])
  );

  // A category that did not run is not a score of zero. Treating it as one would either
  // fail the build for the wrong reason, or — worse — be "fixed" by lowering the floor.
  for (const required of ['performance', 'pwa']) {
    if (cats[required] == null) {
      throw new Error(
        `Lighthouse did not report a "${required}" category. ` +
          `Categories present: ${Object.keys(cats).join(', ')}`
      );
    }
  }

  const perf = cats.performance;
  const pwa = cats.pwa;

  const outDir = '.lighthouse';
  mkdirSync(outDir, { recursive: true });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(outDir, 'report.json'), runnerResult.report);

  console.log('\nLighthouse — production build');
  console.log('='.repeat(52));
  for (const [name, score] of Object.entries(cats)) {
    const floor = name === 'performance' ? PERF_FLOOR : name === 'pwa' ? PWA_FLOOR : 0;
    const mark = floor ? (score >= floor ? 'PASS' : 'FAIL') : '    ';
    console.log(`  ${mark}  ${name.padEnd(16)} ${String(score).padStart(3)}`);
  }

  // The audits that actually decide the PWA score, printed whether or not they passed —
  // a bare score hides which requirement is missing.
  console.log('\n  PWA requirement detail');
  for (const id of [
    'installable-manifest',
    'service-worker',
    'splash-screen',
    'themed-omnibox',
    'maskable-icon',
    'content-width',
    'viewport'
  ]) {
    const a = lhr.audits[id];
    if (!a) continue;
    console.log(`   ${a.score === 1 ? 'ok  ' : 'WARN'} ${id.padEnd(22)} ${a.displayValue ?? ''}`);
  }
  console.log(`\n  full report: ${outDir}/report.json`);

  if (perf < PERF_FLOOR || pwa < PWA_FLOOR) {
    console.error(`\nBelow the DoD floor (perf ≥ ${PERF_FLOOR}, PWA ≥ ${PWA_FLOOR}).`);
    exitCode = 1;
  }
} finally {
  cdp?.kill();
  server.kill();
}

process.exit(exitCode);