# GowsLab

**Local-first cycling performance, route estimation and race-day tracking PWA.**

All data lives on your device (IndexedDB via Dexie). Zero-cost static hosting. Design system: **Crimson Clean** (clean neutral canvas × dark monolith × bright sporty red, Plus Jakarta Sans, editorial athletic).

## License & attribution

GowsLab is released under the **[MIT License](LICENSE)**.

Third-party components are bundled in the build. Their licenses:

| Component | License | Where |
|---|---|---|
| [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans) (self-hosted variable font, bundled as `woff2`) | OFL-1.1 | [public/licenses/Plus-Jakarta-Sans-OFL-1.1.txt](public/licenses/Plus-Jakarta-Sans-OFL-1.1.txt) |
| [Svelte](https://github.com/sveltejs/svelte), [Vite](https://github.com/vitejs/vite), [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa), [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss), [uPlot](https://github.com/leeoniya/uPlot), [Vitest](https://github.com/vitest-dev/vitest) | MIT | `package.json` |
| [Dexie](https://github.com/dexie/Dexie.js) | Apache-2.0 | `package.json` |
| [@lucide/svelte](https://github.com/lucide-icons/lucide) | ISC | `package.json` |

**Formulas, not code.** The cycling-science formulas GowsLab implements — normalized
power / intensity factor / training stress score, the Coggan zone models, CTL/ATL/TSB
performance management, the Morton critical-power (CP/W′) model, and the gravity /
rolling-resistance / aerodynamic power equations — are published science and common
knowledge (Coggan & TrainingPeaks publications, Morton 2006, Martin et al. 1998). They are
implemented from those formulas in original code. **No source code was copied from any other
project.** In particular, [GoldenCheetah](https://github.com/GoldenCheetah/GoldenCheetah)
(GPL-2.0) and the other repositories listed in
[docs/REFERENCES.md](docs/REFERENCES.md) were used as *feature and algorithm references*
only. Full audit trail: [docs/REFERENCES.md](docs/REFERENCES.md).

## Stack

Svelte 5 (runes) · Vite 8 · TypeScript strict · Tailwind 4 · Dexie 4 · vite-plugin-pwa · uPlot 1.6 (route chart) · Plus Jakarta Sans (self-hosted) · Lucide icons.

> Charts (uPlot) are in; maps (MapLibre) are still P1 — see [docs/ROADMAP.md](docs/ROADMAP.md).
> The domain layer is in: `metrics.ts`, `pmc.ts`, `power-curve.ts`, `zones.ts` (NP/IF/TSS, CTL/ATL/TSB,
> mean-max curve + CP/W' fit, time in zones), `course.ts` (GPX/TCX), `units.ts`, `trend.ts`,
> and the M3 solver pair `physics.ts` + `pacing.ts` (power→speed → finish time → checkpoints →
interactive chart series), plus `race.ts` (cut-off buffer, feasibility, CP/W′ sustainability), with **275 unit tests**.
Still missing: the rest of the race model (full M4 projection vs CP/W′).

## Commands

```bash
npm install
npm run dev        # dev server (default port 5173)
npm run build      # production build + PWA (dist/)
npm run preview    # preview the production build
npm run check      # svelte-check (typecheck)
npm test           # vitest run (domain + data layer)
npm run test:watch # vitest in watch mode
npm run test:e2e   # Playwright: race cockpit against the built app (simulated clock + offline)
npm run test:all   # unit + E2E
npm run icons      # regenerate PWA PNG icons (pure Node, zero deps)
```

First build requires the icons: run `npm run icons` once (or just open the dev server — the manifest references them, but the app works without).

`npm run dev` needs the `$lib` alias declared in [vite.config.ts](vite.config.ts) — tsconfig `paths` alone only satisfies the type checker, not Vite's dev transform.

## Project layout

```
docs/                     PRD · ARCHITECTURE · ROADMAP · UI-SPEC · REFERENCES · STITCH-PROMPTS
mockups/                  standalone HTML visual references for UI decisions
scripts/generate-icons.mjs
src/
  app.css                 Crimson Clean design tokens (@theme)
  App.svelte              hash router shell
  lib/
    router.svelte.ts      minimal hash router (Svelte 5 runes)
    domain/               pure logic: metrics (NP/IF/TSS), pmc, power-curve, zones, course (GPX/TCX), units, trend, physics, pacing
    components/           UI-SPEC §6 base components (StatTile, AppNav, HatchTrack, ...)
    data/                 Dexie schema v2 + seed + stream codec + live queries (ARCHITECTURE.md §4)
    routes/               dashboard · rides · routes · race · gear · coach · settings
```

`src/lib/domain/` holds `metrics.ts`, `pmc.ts`, `power-curve.ts`, `zones.ts`, `course.ts`,
`units.ts`, `trend.ts`, `physics.ts`, `pacing.ts` and `race.ts` (all unit-tested) — see the
status table in [docs/ROADMAP.md](docs/ROADMAP.md).

## Docs

- [docs/PRD.md](docs/PRD.md) — features F1–F8, acceptance criteria, MVP scope
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, data model, physics, Strava integration, compliance
- [docs/ROADMAP.md](docs/ROADMAP.md) — phase status + the recommended execution order
- [docs/UI-SPEC.md](docs/UI-SPEC.md) — per-screen hierarchy, Stitch adoption rules, decisions up to §28
- [docs/STITCH-PROMPTS-v5.md](docs/STITCH-PROMPTS-v5.md) — Google Stitch prompt source (historical reference)

## Deploy (zero-cost)

Cloudflare Pages: build `npm run build`, output `dist/`. Hash routing means no redirect rules needed.

## Status

**The UI is no longer ahead of the domain logic.** M0–M3 are implemented and tested (275 unit tests);
the remaining gap is the full race projection. Design work is at **v6.2** (see [docs/UI-SPEC.md](docs/UI-SPEC.md)):

| Phase | State |
| --- | --- |
| M0 foundation | **Done** — Svelte 5 + Vite + Tailwind 4, hash router, Dexie schema v2, PWA manifest/SW, typecheck & build green |
| M1 data in | **Done** — GPX/TCX parser (`domain/course.ts`, 16 fixture tests) writing activity + compressed streams + odometer update, bike/component CRUD, profile, weight/FTP logs, zone editor (F2-AC4), weight+FTP overlay trend chart (F2-AC2), imperial units (`domain/units.ts`) used across 4 screens, JSON backup/restore, delete-all |
| M2 metrics | **Done** — `domain/metrics.ts` (NP/IF/TSS FTP-aware), `pmc.ts` (CTL/ATL/TSB), `power-curve.ts` (mean-max + CP/W′ fit by damped Gauss-Newton), `zones.ts` (Coggan bands + time in zones). Dashboard has a Power curve card; rides open at `#/rides/:id` |
| M3 estimator | **Done** — `domain/physics.ts` (gravity + rolling + aero + drivetrain loss, bisection speed solver) and `domain/pacing.ts` (IF target, stop policy, checkpoint ETAs with `legKph` + buffer vs cut-off, chart series), 66 tests. `AVG_KMH = 30` is gone: a 200,4 km / 1 345 m route solves to 6h 47m at 31,9 km/h, legs read 23,7 km/h climbing vs 40,8 km/h descending, and a 25 km/h headwind projects 19h 33m with a "too slow to be credible" warning. The profile card is an interactive uPlot chart: altitude area + solved-speed line on twin scales, with a crosshair tooltip reading km, grade, speed, elapsed and clock time |
| M4 race mode | **Partial** — setup, live cockpit and checkpoint logging to Dexie work. `domain/race.ts` (cut-off buffer, AMAN/WASPADA/KRITIS from the M3 solver) is in and the live cockpit now shows a crosshair profile with buffer-vs-cut-off at any point. Still open: the hero buffer/projected finish/required pace still use the constant `AVG_KMH = 30` instead of the solved plan, and feasibility is not yet checked against CP/W′ |
| M5 AI coach | **Stub** — chat persisted to `ai_notes`, no LLM call. App correctly stays fully functional without a key (F5-AC1) |
| M6 Strava/cloud | **Not started** — no backend in the repo; `sync_state` stays empty. P1, out of MVP scope |

Full breakdown and the recommended execution order: [docs/ROADMAP.md](docs/ROADMAP.md).
