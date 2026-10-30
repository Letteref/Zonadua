<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import type { IconName } from '$lib/icons';
  import EditorialHeader from '$lib/components/EditorialHeader.svelte';
  import SpeedProfileChart from '$lib/components/SpeedProfileChart.svelte';
    import { activeBike, appSettings, latestFtp, powerCurves, weightSeries, fetchRouteProfile, fetchRouteTrack, allRoutes, allActivities } from '$lib/data/queries.svelte';
  import { route } from '$lib/router.svelte';
  import { untrack } from 'svelte';
  import { slide } from 'svelte/transition';
  import { db, isCyclingActivity, type Race } from '$lib/data/db';
  import { newId } from '$lib/data/seed';
  import { parseAndStoreRoute } from '$lib/data/route-import';
  import type { ProfilePoint } from '$lib/domain/physics';
  import {
  buildPlan,
  clockOf,
  defaultCheckpoints,
  durationOf,
  planSeries,
  fitIfForAvgSpeed,
  type CheckpointDef
} from '$lib/domain/pacing';
  import { formatDistance, formatElevation, formatWeight, type UnitSystem } from '$lib/domain/units';
  import { toast } from '$lib/toast.svelte';
  import { bearingBetween, peakHeadwind, correctForWind, type WindSample } from '$lib/domain/wind';
  import { fetchWindForecast, fetchRideForecast } from '$lib/infra/weather/openmeteo';
  import { buildDeparturePlan, historicalSpeedKph, type DepartureOption } from '$lib/domain/departure';
  import { checkpointsWithStoredGates, rebaseCutoffsForStart, routeCapability, routeObstacles, type RouteObstacle, type SustainProjection } from '$lib/domain/race';
  import { resolveCpFit } from '$lib/domain/power-curve';

  /** the global pill (UI-SPEC §46); this route only picks the words */
  const showToast = (msg: string, tone: 'ok' | 'error' = 'ok'): void =>
    tone === 'ok' ? toast.ok(msg) : toast.error(msg);

  // ---------- route state (real GPX replaces the M0 preview) ----------
  /**
   * The loaded route's name — empty until a GPX is imported or a library row is opened.
   * It used to start as "Bukit Barisan 200", a name from an early mock, which the header
   * displayed as a headline while the estimator was still on its sample profile: the
   * screen claimed a route that existed nowhere on the device.
   */
  let routeName = $state('');
  let loadedRouteId = $state<string | null>(null);
  /** real elevation profile in km/alt — the physics input, never chart-normalised */
  let rawProfile = $state<ProfilePoint[] | null>(null);

  /**
   * The loaded route's elevation gain at **full resolution**, straight from the import
   * pipeline (`elevGainM`), for as long as a route is loaded.
   *
   * The physics does not run on that resolution: `rawProfile` is the 600-point sample
   * (stride decimation), and a sample that skips three of every four trackpoints also
   * skips the micro-climbs between them — on a real 105 km GPX the sampled profile
   * summed to 589 m against the file's own full-resolution gain. The tile and the header
   * accent used to read `plan.climbM`, so the same screen announced the file's gain in
   * its import toast and printed 589 m in the panel below it. One route, one number: the
   * gain is a property of the file, not of the solver's sampling grid. (The file's own
   * gain is itself smoothed at import — see `elevationGainM` in `domain/course.ts` — so
   * it lands near the same route's Strava figure instead of summing sensor noise.)
   *
   * Null for the sample route, which has no file and falls back to the solver.
   */
  let routeElevStored = $state<number | null>(null);
  let fileInput: HTMLInputElement | null = $state(null);

  /**
   * Sample route used when no GPX is loaded: 200.4 km with a long climb to 1450 m and a
   * fast descent home — the shape the physics model needs to be exercised at all.
   */
  const FALLBACK: ProfilePoint[] = [
    { distKm: 0, altM: 145 }, { distKm: 25, altM: 160 }, { distKm: 50, altM: 140 }, { distKm: 75, altM: 120 },
    { distKm: 100, altM: 128 }, { distKm: 120, altM: 300 }, { distKm: 140, altM: 700 }, { distKm: 150, altM: 1000 },
    { distKm: 160, altM: 1200 }, { distKm: 168, altM: 1350 }, { distKm: 174, altM: 1450 }, { distKm: 178, altM: 1200 },
    { distKm: 185, altM: 800 }, { distKm: 195, altM: 400 }, { distKm: 200.4, altM: 150 }
  ];

  const profile = $derived(rawProfile ?? FALLBACK);
  const hasRoute = $derived(rawProfile !== null);
  const routeKm = $derived(profile.at(-1)?.distKm ?? 0);

  

  // ---------- pacing model (M3: physics, not distance ÷ a constant) ----------
  const START_MIN = 5 * 60 + 30;
  const ftp = $derived(latestFtp.current?.ftp ?? 275);
  const unit = $derived<UnitSystem>(appSettings.current?.unit ?? 'metric');
  const riderKg = $derived(weightSeries.current?.at(-1)?.kg ?? 68);
  const bike = $derived(activeBike.current?.bike);

  const modes = [
    { name: 'Endurance', if: 0.65 },
    { name: 'Steady', if: 0.72 },
    { name: 'Attack', if: 0.81 }
  ] as const;
  /** manual intensity — the presets *and* the slider below write here */
  let targetIf = $state(0.72);
  /** power (IF) or an average speed the solver inverts to an IF */
  let targetType = $state<'power' | 'speed'>('power');
  let targetSpeedKph = $state(30);

  // editable setup — every one of these moves the physics
  let cargoKg = $state(3);
  let stopCount = $state(2);
  let stopMin = $state(15);
  let headwindKph = $state(0);
  let startMin = $state(START_MIN);

  /** The editable face of `startMin`: the solver reads minutes-past-midnight, the rider sets a clock. */
  const startClock = $derived(
    `${String(Math.floor(startMin / 60) % 24).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`
  );

  function setStartClock(v: string): void {
    const [h, m] = v.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return;
    startMin = (Math.max(0, Math.min(23, h)) * 60 + Math.max(0, Math.min(59, m))) % 1440;
  }

  /**
   * Wind forecast (ROADMAP M5 DoD line 4).
   *
   * The plan's wind is still an explicit slider, because a stored route carries only
   * distance and altitude — `Routes.svelte` drops lat/lng when it compresses the track to
   * `[km, alt]` pairs. Without a bearing there is no honest way to turn a forecast into a
   * headwind, and guessing one would be the single worst thing this feature could do: a
   * wind from behind mis-applied to a headwind route makes a slow day look fast.
   *
   * So the forecast is fetched and *shown*, with the rider supplying the direction their
   * route runs. `windDeg` is therefore an input, never a default.
   */
  let windForecast = $state<WindSample[] | null>(null);
  /**
   * Coordinates of the loaded GPX.
   *
   * Taken from the file the rider actually imported, never from a hardcoded place. A
   * forecast for the wrong hill is not a forecast, and a sample route's coordinates would
   * silently attach real weather to a profile nobody is riding.
   */
  let routeCoords = $state<{ lat: number; lng: number } | null>(null);
  let windBearing = $state<number | null>(null);
  let windBusy = $state(false);
  let windNote = $state<string | null>(null);

  const peakForecast = $derived(
    windBearing != null && windForecast ? peakHeadwind(windForecast, windBearing) : null
  );

  /**
   * Build the plan for a given headwind.
   *
   * Named so the correction below can solve twice without duplicating the ~20 arguments —
   * the risk being that pass 2 quietly solves a *different* plan than pass 1 and the drift
   * it reports is then measuring the wrong thing.
   */
  /**
   * The rider, the bike and the day. Every physics pass on this page — the solver, the
   * wind correction, the capability panel below — reads this one block, so the verdict
   * is never computed against numbers the plan did not ride by (the race page's
   * `racePhysics` rule, kept here for the same reason).
   */
  const basePhysics = $derived({
    riderKg,
    bikeKg: bike?.weightKg ?? 9.4,
    cargoKg,
    crr: bike?.crr ?? 0.0045,
    cda: bike?.cda ?? 0.32,
    temperatureC: 20
  });

  function solveWithIf(ifTarget: number, headwind: number) {
    return buildPlan({
      profile,
      physics: { ...basePhysics, headwindKph: headwind },
      pacing: { mode: 'if', ifTarget, ftp },
      stops: { count: stopCount, minutesEach: stopMin },
      startMin,
      checkpoints: routeCheckpoints
    });
  }

  function solveWith(headwind: number) {
    return solveWithIf(pacingIf, headwind);
  }

  /**
   * Speed target → intensity. The bisection walks the *manual* headwind so its inputs
   * never depend on its own output; the wind-corrected pass below then re-solves the
   * fitted IF through `solveWith`, so one number feeds every readout on the screen.
   */
  const speedFit = $derived.by(() => {
    if (targetType !== 'speed') return null;
    return fitIfForAvgSpeed((ift) => solveWithIf(ift, headwindKph), targetSpeedKph);
  });

  /** The intensity every readout on this screen is built from. */
  const pacingIf = $derived(targetType === 'speed' ? (speedFit?.ifTarget ?? targetIf) : targetIf);

  /**
   * The bar is the slider: a drag maps x → IF on the bar's own 0.55–0.95 scale, the same
   * numbers printed at its ends. The manual range below writes the identical `targetIf`,
   * so the two controls can never disagree about what the target is.
   */
  function setIfFromBar(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const frac = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    targetIf = Math.round((0.55 + Math.max(0, Math.min(1, frac)) * 0.4) * 100) / 100;
  }

  /**
   * The wind-corrected plan (ROADMAP M5 "2-iterasi koreksi").
   *
   * Falls back to the rider's manual slider whenever a forecast is missing or the track
   * has no bearing — an uncorrected plan the rider chose, never a plan the app invented.
   */
  const windCorrected = $derived.by(() => {
    if (!windForecast || windBearing == null) {
      return { plan: solveWith(headwindKph), headwindKph: headwindKph, forecastUsed: false, driftHours: 0, stable: true };
    }
    const result = correctForWind({
      solve: solveWith,
      // the plan solves in minutes past midnight; the forecast is indexed from "now"
      hourAt: (p) => {
        const finishMin = p.ok && p.finishClockMin != null ? p.finishClockMin : startMin;
        const hoursOut = Math.max(0, (finishMin - startMin) / 60);
        return Math.min(windForecast!.length - 1, Math.round(hoursOut));
      },
      windAt: (h) => windForecast![h] ?? null,
      travelDeg: windBearing!
    });
    return result;
  });

  async function loadForecast(): Promise<void> {
    if (windBusy) return;
    if (!routeCoords) {
      windNote = 'Load a GPX first — the forecast needs a real location, not a guess.';
      return;
    }
    windBusy = true;
    windNote = null;
    try {
      const forecast = await fetchWindForecast({
        latitude: routeCoords.lat,
        longitude: routeCoords.lng,
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
      });
      windForecast = forecast;
      if (!forecast) {
        windNote = 'No forecast available — the plan below is windless, not calm.';      } else {
        windNote = `${forecast.length} h forecast. The plan below is solved twice: once for the windless arrival time, then again for the wind the rider actually meets.`;
      }
    } finally {
      windBusy = false;
    }
  }

  // ---------- best start: weather-aware departure picker ----------
  /**
   * "When should I leave?" — scored from the route the estimator already loaded, the
   * rider's *own* historical speed (their log, not a domain average), and Open-Meteo's
   * hourly temperature/rain/wind in the route's timezone.
   *
   * Choosing an option writes `startMin` — the very dial the Setup card edits — so the
   * whole screen re-solves around the chosen roll-out. The picker advises; `buildPlan`
   * stays the single source of every ETA on screen.
   */
  let departBusy = $state(false);
  let departOptions = $state<DepartureOption[]>([]);
  let departBest = $state<number | null>(null);
  let departPicked = $state<number | null>(null);
  let departEvidence = $state('');
  let departNote = $state<string | null>(null);

  /** newest-first cycling rides → the speed the ETA rests on */
  const rideSamples = $derived(
    [...(allActivities.current ?? [])]
      .filter(isCyclingActivity)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((a) => ({ distanceKm: a.distanceKm, movingSec: a.movingSec }))
  );
  const histSpeed = $derived(historicalSpeedKph(rideSamples));

  function departReset(): void {
    departOptions = [];
    departBest = null;
    departPicked = null;
    departNote = null;
  }

  async function findBestStart(): Promise<void> {
    if (departBusy) return;
    if (!routeCoords) {
      departNote = 'This route has no GPS track stored — re-import the GPX to unlock weather-aware start times.';
      return;
    }
    if (!histSpeed) {
      departNote = 'No ride history yet — the ETA comes from your own log, not from a guess.';
      return;
    }
    departBusy = true;
    try {
      // three days: a late-evening look at tomorrow's 06:00 roll-out needs tomorrow's
      // hours too. Dates are built in UTC like the wind card; the extra day covers the
      // route-local shift Open-Meteo reports through `utc_offset_seconds`.
      const fc = await fetchRideForecast({
        latitude: routeCoords.lat,
        longitude: routeCoords.lng,
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
      });
      if (!fc) {
        departOptions = [];
        departBest = null;
        departNote = 'No forecast available — the picker will not offer hours it cannot score.';
        return;
      }
      const built = buildDeparturePlan({
        forecast: fc.hours,
        utcOffsetSeconds: fc.utcOffsetSeconds,
        nowEpochMin: Math.floor(Date.now() / 60000),
        distanceKm: routeKm,
        speed: histSpeed,
        bearingDeg: windBearing,
        horizonHours: 24
      });
      if (!built) {
        departOptions = [];
        departBest = null;
        departNote = 'The forecast does not cover a full ride from any hour — nothing honest to score.';
        return;
      }
      departOptions = built.options;
      departBest = built.bestIndex;
      departPicked = built.bestIndex;
      departEvidence = built.evidence;
      departNote = null;
    } finally {
      departBusy = false;
    }
  }

  /** Choosing a roll-out writes the same `startMin` the Setup card edits: one plan. */
  function pickDeparture(idx: number): void {
    const o = departOptions[idx];
    if (!o) return;
    const [h, m] = o.startClock.split(':').map(Number);
    startMin = (h * 60 + m) % 1440;
    departPicked = idx;
  }

  const npTarget = $derived(Math.round(pacingIf * ftp));
  const barPct = $derived(Math.max(2, Math.min(100, ((pacingIf - 0.55) / 0.4) * 100)));

  /**
   * Control points for THIS profile — derived, never typed.
   *
   * This used to be a literal five-row list from one mock course (km 25 / 87 / 120 / 160 /
   * 200.4, with names like "Koto Tinggi Climb"), shown for every GPX the rider loaded.
   * The ETAs were solved from physics, but the positions were fiction — and on a shorter
   * route the finish clamp stacked three of them on the same metre. `defaultCheckpoints`
   * reads the loaded profile instead: one point per ~50 km of the route that actually
   * exists, labelled by its own terrain, finish at the route's true end. No cut-offs:
   * gates belong to the race page, where the rider enters what the organizer published.
   *
   * The rider edits this list in the table below (km, label, add, remove); the first edit
   * materialises it into `customCheckpoints`, and switching routes drops it back to null —
   * the previous route's kilometres describe the previous route. Edits live in memory
   * until `Save as race plan` writes them; a reload returns to the derived set.
   */
  let customCheckpoints = $state<CheckpointDef[] | null>(null);
  const routeCheckpoints = $derived(customCheckpoints ?? defaultCheckpoints(profile));

  /** patch one checkpoint; the list stays sorted because `buildPlan` accrues legs in order */
  function cpPatch(i: number, patch: Partial<CheckpointDef>): void {
    customCheckpoints = routeCheckpoints
      .map((c, j) => (j === i ? { ...c, ...patch } : c))
      .sort((a, b) => a.km - b.km);
  }
  /** km commits on blur/Enter, clamped to the route — past-the-end is not a checkpoint */
  function cpSetKm(i: number, raw: string): void {
    const v = Number.parseFloat(raw);
    if (!Number.isFinite(v)) return;
    cpPatch(i, { km: Math.min(Math.max(0, v), routeKm) });
  }
  function cpRemove(i: number): void {
    customCheckpoints = routeCheckpoints.filter((_, j) => j !== i);
  }
  /** a new point lands mid-gap: the middle of the longest empty stretch, start to finish */
  function cpAdd(): void {
    const kms = [0, ...routeCheckpoints.map((c) => c.km), routeKm].sort((a, b) => a - b);
    let span = 0;
    let at = routeKm / 2;
    for (let i = 1; i < kms.length; i++) {
      const gap = kms[i] - kms[i - 1];
      if (gap > span) {
        span = gap;
        at = (kms[i - 1] + kms[i]) / 2;
      }
    }
    customCheckpoints = [...routeCheckpoints, { km: Math.round(at * 10) / 10, label: 'Checkpoint' }].sort(
      (a, b) => a.km - b.km
    );
  }
  /** back to what the profile derives — forgetting the materialised edits */
  function cpReset(): void {
    customCheckpoints = null;
  }

  /**
   * The plan the whole screen reads.
   *
   * `windCorrected` rather than a second inline `buildPlan`: the ETA, the chart, the
   * checkpoint table and the headwind label all have to describe the same solve, or the
   * screen contradicts itself — a chart that ignores the wind the banner just announced.
   */
  const plan = $derived(windCorrected.plan);

  /** The headwind the plan actually solved with — forecast-derived, or the manual slider. */
  const appliedHeadwind = $derived(windCorrected.headwindKph);

  /**
   * Elevation shown in the header accent and the metric tile: the file's own gain while
   * a route is loaded, the solver's number only for the sample profile. See
   * `routeElevStored` for why those two must not be the same source.
   */
  const routeElevM = $derived(routeElevStored ?? Math.round(plan.climbM ?? 0));
  /** one chart row per solved point — altitude + solved speed + elapsed, never normalised */
  const chartRows = $derived(planSeries(plan));
  const movingSec = $derived(plan.movingSec ?? 0);
  const kcal = $derived(Math.round((plan.energyKJ ?? 0) / 4.184));
  const avgKph = $derived(plan.avgKph ?? 0);
  const estFinish = $derived(plan.ok ? durationOf(plan.elapsedSec!) : '—');
  const etaFinish = $derived(plan.ok ? clockOf(plan.finishClockMin!) : '—');

  // ---------- ride capability (ROADMAP M4 slice 2): CP/W′ over the whole plan ----------
  /**
   * The pair the panel judges against — the same `resolveCpFit` the race page calls, so
   * "Aman" means the same thing on both screens.
   *
   * A measured fit (four merged durations is the minimum the 2-parameter model can
   * honestly fit) wins. Without one, the CP/W′ the rider typed in Settings stands in for
   * it — for the meter they do not own — and `cpFitEntered` makes the card say so instead
   * of passing a typed number off as evidence. With neither, the panel keeps its honest
   * "No CP fit" rather than inventing a verdict.
   */
  const resolvedCpFit = $derived(
    resolveCpFit((powerCurves.current ?? []).map((c) => c.points), appSettings.current?.manualCpW)
  );
  /** the fit itself, for the engines (`routeCapability`, `routeObstacles`) */
  const cpFit = $derived(resolvedCpFit?.fit);
  /** true when those watts are the rider's typed pair, not something their rides measured */
  const cpFitEntered = $derived(resolvedCpFit?.source === 'entered');

  /**
   * The physics the on-screen plan actually solved with: the shared rider block plus
   * the headwind that pass accepted. Judging capability against anything else would
   * grade a ride the rider is not being asked to ride.
   */
  const planPhysics = $derived({ ...basePhysics, headwindKph: appliedHeadwind });

  /**
   * Can this rider ride the plan the chart just drew? — the cockpit's sustainAt/gateBufferAt
   * pair asked over the whole route instead of at a crosshair. Null while there is no
   * solve to scan, which the card renders as "not judged", never as a pass.
   */
  const capability = $derived(
    plan.ok && plan.solution ? routeCapability(chartRows, plan.solution.segments, planPhysics, cpFit) : null
  );

  /**
   * The card's headline word. The pill it sits in is plain mono surface — the same
   * #23252c tag every other deck element wears — so the *only* colour on the card's
   * verdict is the icon and the word themselves, taken from the cockpit's dark status
   * palette. Colour divides the status; it never decorates the container.
   */
  const verdictView = $derived.by(() => {
    switch (capability?.verdict) {
      case 'sustainable':
        return { word: 'Sustainable', cls: 'text-[#4ade9a]', icon: 'check' as const };
      case 'limited':
        return { word: 'At risk', cls: 'text-[#ffb35a]', icon: 'triangle-alert' as const };
      case 'spent':
        return { word: 'Not sustainable', cls: 'text-[#ff8a92]', icon: 'octagon-alert' as const };
      case 'unknown':
        return { word: 'No CP fit', cls: 'text-on-mono-dim', icon: 'gauge' as const };
      default:
        return { word: 'Not judged', cls: 'text-on-mono-dim', icon: 'gauge' as const };
    }
  });

  /**
   * The terrain the plan must survive, worst first — climbs ≥ 3 % and stalls at target
   * power, each judged by the same sustain engine at its steepest point, so this list
   * and the card's headline can never disagree about the engine behind them. Empty
   * while there is no solve (the card says "not judged" rather than "nothing to dodge").
   */
  const obstacles = $derived(
    plan.ok && plan.solution && chartRows.length >= 2
      ? routeObstacles(chartRows, plan.solution.segments, planPhysics, cpFit)
      : []
  );
  /**
   * One obstacle open at a time — the card has to stay scannable after a tap. Keyed by
   * the obstacle's start km (not the each index) so a plan recompute can never make the
   * open row point at a different feature.
   */
  let openObstacle = $state<number | null>(null);

  /**
   * Whether the accordion shows everything or only its worst 8. The list is sorted
   * worst-first, so the collapsed state is the 8 that would bite hardest — the toggle
   * exists because the steep/breath fixes let a real route carry a dozen features, and
   * a card that scrolls forever stops being scannable on the phone it is read on.
   */
  let showAllObstacles = $state(false);

  /**
   * The tightest point printed at a precision that can still be told apart from the
   * feature's own edges. One decimal is 100 m — coarser than a solver segment — so a
   * point 40 m into a climb rounds back onto its start and reads as "the beginning of
   * the segment", the exact complaint this figure earned. Two decimals appear only when
   * one would collide with the km range printed on the row above.
   */
  function tightestKmLabel(o: RouteObstacle): string {
    const one = o.judgement.km.toFixed(1);
    return one === o.startKm.toFixed(1) || one === o.endKm.toFixed(1)
      ? o.judgement.km.toFixed(2)
      : one;
  }

  /**
   * Row status: the pill's three words at row scale. Without a fit there is no status
   * word at all — geometry is still true, but a colour next to it would pretend.
   */
  function obstacleStatus(j: SustainProjection): { word: string; cls: string } | null {
    if (j.cp == null) return null;
    if (j.sustainable) return { word: 'Sustainable', cls: 'text-[#4ade9a]' };
    return j.wPrimeLeft === 0
      ? { word: 'Not sustainable', cls: 'text-[#ff8a92]' }
      : { word: 'At risk', cls: 'text-[#ffb35a]' };
  }

  const setupTiles = $derived([
    { icon: 'bike', label: 'Bike:', value: bike?.name ?? '—', tone: 'aman' },
    { icon: 'backpack', label: 'Cargo:', value: formatWeight(cargoKg, unit), tone: 'aman' },
    { icon: 'coffee', label: 'Stops:', value: `${stopCount} × ${stopMin} min`, tone: 'signal' },
    { icon: 'sun', label: 'Start:', value: clockOf(startMin), tone: 'signal' }
  ] as const satisfies readonly { icon: IconName; label: string; value: string; tone: string }[]);

  /**
   * Table rows: the rider's checkpoint list (edited or derived), each paired with the
   * solve at the same position. Rows come from the *list*, not from the plan, so a
   * checkpoint stays visible and editable even when the plan cannot solve yet.
   */
  const waypoints = $derived(
    routeCheckpoints.map((c, i) => {
      const s = plan.checkpoints[i];
      return {
        km: c.km,
        label: c.label ?? '',
        grade: s
          ? `${s.gradePct >= 0 ? '+' : ''}${s.gradePct.toFixed(1)}% grade · ${s.legKph.toFixed(1)} km/h leg`
          : null,
        eta: s ? clockOf(s.clockMin) : '—',
        elapsed: s ? durationOf(s.elapsedSec) : '—'
      };
    })
  );

  // ---------- GPX import → Route record ----------
  async function onGpxPick(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await importRouteFile(file);
  }

  let dragOver = $state(false);

  async function importRouteFile(file: File): Promise<void> {
    toast.busy('Parsing route…');
    try {
      // one import pipeline, shared with the Route library (lib/data/route-import.ts)
      const r = await parseAndStoreRoute(file);
      loadedRouteId = r.id;
      // a new route means new derived checkpoints; the previous list described the old one
      customCheckpoints = null;
      routeName = r.name;
      rawProfile = r.sampled;
      routeElevStored = r.elevGainM;
      // the file carries its own location and direction: the previous route's coordinates
      // and bearing describe the previous hill, and a forecast fetched for them would be
      // weather for a place this file never went. Wind goes back to manual.
      routeCoords = r.coords;
      windBearing = r.bearingDeg;
      windForecast = null;
      windNote = null;
      // keep the URL honest: the screen now shows this row, so #/routes/:id points at it.
      // The preview effect below sees loadedRouteId already set and does not re-decode.
      route.navigateTo('routes', r.id);
      showToast(
        `Loaded ${r.name} — ${formatDistance(r.distanceKm, unit)} · ${formatElevation(r.elevGainM, unit)} of climbing`
      );
    } catch (err) {
      console.error('[zonadua] route import failed:', err);
      showToast('Import failed — use a GPX file with trackpoints', 'error');
    }
  }

  // ---------- library dropdown beside "Choose GPX file" (empty state) ----------
  /** Saved routes, newest first — the dropdown's options. */
  const savedRoutes = $derived(
    [...(allRoutes.current ?? [])].sort((a, b) => b.createdAt - a.createdAt)
  );
  /** Controlled select value; cleared after each pick so a failed load can be retried. */
  let savedPick = $state('');

  /**
   * Picking from the dropdown is the same journey as tapping a Route library row:
   * navigate to `#/routes/:id` and let the preview effect load it. One loader, two
   * doors — a second load path here would drift from the one the library trusts.
   */
  function onPickSaved(e: Event): void {
    const id = (e.currentTarget as HTMLSelectElement).value;
    savedPick = '';
    if (id) route.navigateTo('routes', id);
  }

  // ---------- library preview: opening #/routes/:id from the Route library ----------
  /**
   * A row in the Route library links to `#/routes/:id`; this is what makes that link mean
   * something. The stored profile is decoded and run through the same estimator the import
   * path feeds — the rider sees the real projection, not a placeholder.
   *
   * The stored track (`trackCompressed`) carries every GPS fix the file recorded, so a
   * preview restores terrain *and* location: coordinates and bearing are read back off
   * the track, which is what lets the wind card and the departure picker run on a
   * saved route. A row older than the track column leaves both null — the forecast
   * stays off rather than inheriting the coordinates of whatever hill was loaded
   * before. Without a bearing there is no honest way to turn a forecast into a
   * headwind, and guessing one would be the single worst thing this feature could do.
   *
   * `loadedRouteId` is read untracked: the import path writes it while this same id sits in
   * the URL, and letting that write re-trigger the effect would re-decode the *previous*
   * row and clobber the import that just happened.
   */
  $effect(() => {
    const id = route.name === 'routes' ? route.detailParam : null;
    if (!id || id === untrack(() => loadedRouteId)) return;
    void (async () => {
      try {
        const [row, pts, track] = await Promise.all([
          db.routes.get(id),
          fetchRouteProfile(id),
          fetchRouteTrack(id)
        ]);
        if (loadedRouteId === id) return; // an import won the race while decoding
        if (!row || pts.length < 2) {
          showToast('That saved route could not be opened', 'error');
          route.navigate('routes');
          return;
        }
        // bound the rendered point count the same way import does
        const stride = Math.ceil(pts.length / 600);
        const sampled = pts.filter((_, i) => i % stride === 0 || i === pts.length - 1);
        loadedRouteId = id;
        // opening a different saved route likewise forgets the previous route's edits
        customCheckpoints = null;
        routeName = row.name;
        rawProfile = sampled;
        routeElevStored = row.elevGainM;
        windForecast = null;
        windNote = null;
        // the saved route's own track restores the location the old preview dropped:
        // first fix is the honest forecast anchor, the first valid segment its bearing
        routeCoords = track.length >= 2 ? { lat: track[0].lat, lng: track[0].lng } : null;
        let bearing: number | null = null;
        for (let k = 1; k < track.length && bearing == null; k++) {
          bearing = bearingBetween(track[k - 1].lat, track[k - 1].lng, track[k].lat, track[k].lng);
        }
        windBearing = bearing;
        departReset();
        showToast(`Previewing ${row.name} — ${formatDistance(row.distanceKm, unit)}`);
      } catch (err) {
        console.error('[zonadua] route preview failed:', err);
        showToast('That saved route could not be opened', 'error');
      }
    })();
  });

  // ---------- save as race plan → Dexie → Race page ----------
  async function saveAsRacePlan(): Promise<void> {
    try {
      const routeRows = await db.routes.toArray();
      const routeId = loadedRouteId ?? routeRows[0]?.id ?? 'stub-route';

      // The saved start is the time this screen is showing: a picked departure carries
      // its *date* as well as its clock (a forecast hour can sit on tomorrow), while a
      // manually typed clock keeps today's date, as it always did. An existing race
      // gets the same treatment — leaving its old startTime behind would keep the old
      // roll-out while every card on this screen displays the new one.
      const chosen = departPicked != null ? departOptions[departPicked] : null;
      const startTime = chosen
        ? new Date(chosen.startEpochMin * 60000).toISOString()
        : new Date(new Date().setHours(0, 0, 0, 0) + startMin * 60000).toISOString();
      const savedClock = chosen ? chosen.startClock : clockOf(startMin);

      const existing = await db.races.where('status').anyOf(['planned', 'live']).toArray();

      // Cut-offs travel in different units on the two screens: the estimator's table
      // speaks wall-clock gates ("beat 13:00"), the race page stores minutes *after the
      // start*. Saving with a new roll-out must therefore re-express them against it —
      // copying the old numbers would drag the gate to 15:00 under a 02:00 start while
      // the estimator still says 13:00. `rebaseCutoffsForStart` keeps each gate and
      // re-measures it from the start being saved, for fresh saves and existing races
      // alike.
      const startWallOf = (iso: string): number => {
        const d = new Date(iso);
        return d.getHours() * 60 + d.getMinutes();
      };
      // A fresh save has no organizer gates to inherit — only the estimate this screen
      // just solved. The finish default is ETA plus margin (a quarter of the ride, at
      // least an hour, rounded up to the half hour the race dial steps in), so a longer
      // route gets a later gate instead of the literal 13:00 every race used to inherit.
      // It is a planning default the race page's dial corrects, not an event fact — and
      // as a duration it survives a finish past midnight, which a wall-clock gate cannot.
      const estFinishMin = plan.ok && plan.finishClockMin != null ? plan.finishClockMin - startMin : null;
      const finishDurationMin =
        estFinishMin != null
          ? estFinishMin + Math.max(60, Math.ceil((estFinishMin * 0.25) / 30) * 30)
          : 10 * 60; // no solved plan (no FTP yet): a plain default the dial can correct
      const cutoffs = rebaseCutoffsForStart({
        prev: existing[0]
          ? {
              startWallMin: startWallOf(existing[0].startTime),
              cutoffFinishMin: existing[0].cutoffFinishMin,
              checkpoints: existing[0].checkpoints
            }
          : null,
        // fresh: the finish duration above, and no checkpoint gates — the old list
        // injected "CP2 Payakumbuh" at km 120 into every race, whatever the route
        freshGates: { finishDurationMin, checkpoints: [] },
        nextStartWallMin: startWallOf(startTime)
      });

      // Positions come from the planner's list — edits in the table included; a save
      // that quietly kept the race's old kilometres would discard the very changes the
      // button was pressed to apply. The race's own gates survive by matching km (already
      // rebased above): a point the rider deleted or moved takes its gate with it.
      const savedCheckpoints = checkpointsWithStoredGates(
        routeCheckpoints.map((c) => ({ km: c.km, label: c.label?.trim() || undefined })),
        cutoffs.checkpoints
      );

      const base: Race = existing[0]
        ? {
            ...existing[0],
            name: routeName || 'Sample route',
            startTime,
            cutoffFinishMin: cutoffs.cutoffFinishMin,
            checkpoints: savedCheckpoints,
            status: 'planned',
            updatedAt: Date.now()
          }
        : {
            id: newId(),
            routeId,
            name: routeName || 'Sample route',
            startTime,
            cutoffFinishMin: cutoffs.cutoffFinishMin,
            // the planner's own control points, positions and labels only: the rider
            // enters each gate (or none) on the race page, where the editor lives
            checkpoints: savedCheckpoints,
            // carry the solved plan, not just the inputs — M4 projects from this
            planJson: JSON.stringify({
              ifTarget: pacingIf,
              cargoKg,
              stopCount,
              stopMin,
              headwindKph,
              bikeId: bike?.id,
              targetWatts: plan.targetWatts,
              movingSec,
              elapsedSec: plan.elapsedSec,
              avgKph,
              climbM: routeElevM
            }),
            status: 'planned',
            updatedAt: Date.now()
          };
      await db.races.put(base);
      showToast(`Race plan saved for ${savedClock} — opening Race…`);
      setTimeout(() => route.navigate('race'), 800);
    } catch (err) {
      console.error('[zonadua] saveAsRacePlan failed:', err);
      showToast('Could not save the plan', 'error');
    }
  }
</script>

<div class="mx-auto max-w-md px-5 pt-8 pb-10 flex flex-col gap-5">
  <EditorialHeader
    kicker={hasRoute ? 'Route specification' : 'Route estimator'}
    headline={routeName || 'Plan a ride'}
    sub={hasRoute ? 'Loaded from GPX —' : 'No route loaded yet —'}
    accent={hasRoute ? `${formatDistance(routeKm, unit)} · ${formatElevation(routeElevM, unit)} of climbing.` : 'sample route below.'}
  />

  <input bind:this={fileInput} class="hidden" type="file" accept=".gpx" onchange={onGpxPick} aria-label="Import GPX route" />

  {#if hasRoute && savedRoutes.length > 0}
    <!-- Switching routes without leaving the page: the import card below is gone once a
         route is loaded, so without this row the only way to another GPX was the Library.
         The button opens a fresh GPX (same pipeline as a first import); picking a select
         option navigates to #/routes/:id — the same loader the Library rows use, so there
         is one load path, not two. -->
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="h-11 w-11 shrink-0 rounded-pill bg-surface border border-hairline grid place-items-center text-ink-dim hover:text-crimson-deep hover:border-hairline-strong transition-colors elevation-card"
        onclick={() => fileInput?.click()}
        aria-label="Open GPX file"
        title="Open GPX"
      >
        <Icon name="file-up" size={18} strokeWidth={1.5} />
      </button>
      <select
        class="h-11 flex-1 min-w-0 rounded-pill bg-tile border border-hairline-strong px-3 text-[11px] font-extrabold uppercase tracking-wider text-ink outline-none focus:border-signal cursor-pointer"
        aria-label="Switch to another saved route"
        value={savedPick}
        onchange={onPickSaved}
      >
        <option value="" disabled>Switch route · {savedRoutes.length} saved</option>
        {#each savedRoutes as r (r.id)}
          <option value={r.id}>{r.name} · {r.distanceKm.toFixed(1)} km</option>
        {/each}
      </select>
    </div>
  {/if}

  {#if !hasRoute}
    <!-- EMPTY STATE: the estimator is ready, waiting for a route -->
    <div
      class="rounded-card border-2 border-dashed {dragOver ? 'border-signal bg-signal/5' : 'border-hairline-strong bg-surface'} p-6 flex flex-col items-center text-center gap-3 elevation-card transition-colors cursor-pointer"
      role="button"
      tabindex="0"
      aria-label="Import GPX route — choose a file or drop it here"
      onclick={() => fileInput?.click()}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInput?.click();
        }
      }}
      ondragover={(e) => {
        e.preventDefault();
        dragOver = true;
      }}
      ondragleave={() => (dragOver = false)}
      ondrop={(e) => {
        e.preventDefault();
        dragOver = false;
        const f = (e as DragEvent).dataTransfer?.files?.[0];
        if (f) void importRouteFile(f);
      }}
    >
      <div class="grid h-14 w-14 place-items-center rounded-pill bg-tile border border-hairline text-crimson-deep">
        <Icon name="file-up" size={24} strokeWidth={1.5} />
      </div>
      <div class="flex flex-col gap-1">
        <h2 class="text-base font-extrabold tracking-tight text-ink">Import your event GPX</h2>
        <p class="text-[13px] text-ink-dim leading-relaxed max-w-[32ch]">
          The estimator reads the route profile and projects your finish from FTP {ftp} W, your active bike and stop pattern — fully offline.
        </p>
      </div>
      <!-- stacked, never side-by-side: at phone width these two controls cannot share
           one row without the select or the button spilling past the card's border -->
      <div class="flex flex-col gap-2 w-full max-w-[280px]">
        <button
          class="h-11 w-full justify-center rounded-pill bg-crimson-fill text-white text-[11px] font-extrabold uppercase tracking-wider flex items-center gap-2 glow-signal active:scale-[0.98] transition-transform"
          onclick={(e) => {
            e.stopPropagation();
            fileInput?.click();
          }}
        >
          <Icon name="file-up" size={16} strokeWidth={2} />
          Choose GPX file
        </button>
        {#if savedRoutes.length > 0}
          <!-- stopPropagation, same as the button: the card itself is a click-to-import
               target, and opening a file dialog behind a dropdown would be a trap -->
          <select
            class="h-11 w-full rounded-pill bg-tile border border-hairline-strong px-3 text-[11px] font-extrabold uppercase tracking-wider text-ink outline-none focus:border-signal cursor-pointer"
            aria-label="Preview a saved route from the library"
            value={savedPick}
            onclick={(e) => e.stopPropagation()}
            onchange={onPickSaved}
          >
            <option value="" disabled>Library ({savedRoutes.length})</option>
            {#each savedRoutes as r (r.id)}
              <option value={r.id}>{r.name} · {r.distanceKm.toFixed(1)} km</option>
            {/each}
          </select>
        {/if}
      </div>
      <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">or drag &amp; drop it anywhere on this card</span>
    </div>
  {/if}

  <!-- Hero deck: projected result (monolith highlight) -->
  <section class="bg-mono text-on-mono glow-mono bg-mono-gradient rounded-card p-4 flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <span class="flex items-center gap-2">
        <span class="h-1.5 w-1.5 rounded-pill bg-crimson"></span>
        <span class="text-[11px] font-bold uppercase tracking-[0.08em] text-on-mono-dim">Projected ride time</span>
      </span>
      <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-pill bg-[#23252c] text-rose border border-[#2b2d33]">{hasRoute ? 'Preview' : 'Sample plan'}</span>
    </div>
    <!--
      Two tiles, one component.

      They used to differ in every visible way — background shade, border tone, and content
      depth — so the pair read as two unrelated cards rather than one idea at two levels of
      emphasis. Now the boxes are identical and only the *figure colour* carries the
      hierarchy: EST FINISH is the primary number, TARGET ARRIVE the secondary one. Making
      the boxes differ to express hierarchy would have re-created the problem.

      Both tiles also have three lines. EST FINISH gained its third line when MOVING moved
      out of the stat strip below, and leaving the other tile at two would have left one box
      visually taller than its twin — hence WIB moving off the end of the number and onto a
      line of its own, where it stops crowding the 26 px baseline.
    -->
    <div class="grid grid-cols-2 gap-2.5">
      <div class="rounded-2xl px-3 py-2.5 flex flex-col items-center justify-center text-center bg-[#23252c] border border-[#2b2d33] min-h-16">
        <span class="text-[10px] font-extrabold uppercase tracking-wider text-on-mono-dim">Est finish</span>
        <span class="text-[26px] font-extrabold text-rose text-tabular tracking-tight leading-none mt-0.5">{estFinish}</span>
        <span class="text-[9px] font-bold uppercase tracking-[0.1em] text-on-mono-dim text-tabular whitespace-nowrap mt-1.5">
          Moving {durationOf(movingSec)}
        </span>
      </div>
      <div class="rounded-2xl px-3 py-2.5 flex flex-col items-center justify-center text-center bg-[#23252c] border border-[#2b2d33] min-h-16">
        <span class="text-[10px] font-extrabold uppercase tracking-wider text-on-mono-dim">Target arrive</span>
        <span class="text-[26px] font-extrabold text-on-mono text-tabular tracking-tight leading-none mt-0.5">{etaFinish}</span>
        <span class="text-[9px] font-bold uppercase tracking-[0.1em] text-on-mono-dim text-tabular whitespace-nowrap mt-1.5">
          WIB
        </span>
      </div>
    </div>
    <!--
      One line, always — and 11 px, always.

      The previous version used `flex-wrap` with loose inline text ("AVG" then
      "31.9 KM/H"), so a long value split the stat across two lines *and* the strip itself
      could wrap, growing the card a row on the screen where the rider is planning.

      `whitespace-nowrap` stops a label splitting from its number, but that alone is not
      enough: the strip is ~30 px wide per px of font size, so keeping MOVING here meant a
      one-line strip only fitted at 11 px on a 420 px screen and needed ~8 px on a 320 px
      one — unreadable. Moving MOVING up into the EST FINISH tile, where it belongs next to
      the elapsed time it is a subset of, buys back ~24 % of the width and the full 11 px
      now fits at every phone width.
    -->
    <div
      class="flex items-center justify-center gap-2 pt-1 border-t border-[#2b2d33] text-[11px] font-bold uppercase tracking-[0.06em] whitespace-nowrap"
    >
      <div class="flex items-center gap-2 min-w-0 text-tabular">
        <span class="text-on-mono-dim">AVG <span class="text-on-mono">{avgKph.toFixed(1)} KM/H</span></span>
        <!-- Separators give way first on the narrowest phones. They are the only part of the
             strip that carries no information, and dropping them recovers ~28 px, which is
             exactly the margin a pathological plan (five-digit kcal, a 40 h estimate) needs
             to stay on one line. Each metric keeps its own label, so nothing becomes
             ambiguous without them. -->
        <span class="text-[#3f434b] shrink-0 hidden min-[340px]:inline">•</span>
        <span class="text-on-mono-dim"><span class="text-on-mono">{kcal.toLocaleString()}</span> KCAL</span>
        <span class="text-[#3f434b] shrink-0 hidden min-[340px]:inline">•</span>
        <span class="text-rose">{npTarget} W NP</span>
      </div>
    </div>
    <div class="grid grid-cols-4 gap-1.5 pt-0.5">
      <div class="flex items-center justify-center gap-1 py-1.5 px-1 rounded-xl bg-[#1b1c22] border border-[#2b2d33] text-on-mono">
        <span class="text-[10px] font-bold text-tabular">{formatDistance(routeKm, unit, 1)}</span>
      </div>
      <div class="flex items-center justify-center gap-1 py-1.5 px-1 rounded-xl bg-[#1b1c22] border border-[#2b2d33] text-on-mono">
        <span class="text-[10px] font-bold text-tabular text-rose">{formatElevation(routeElevM, unit)} ↑</span>
      </div>
      <div class="flex items-center justify-center gap-1 py-1.5 px-1 rounded-xl bg-[#1b1c22] border border-[#2b2d33]">
        <span class="h-1.5 w-1.5 rounded-pill bg-crimson"></span>
        <span class="text-[9px] font-bold tracking-tight text-rose">{hasRoute ? 'GPX' : 'SAMPLE'}</span>
      </div>
      <!-- Obstacle *features*, the same merged rows the accordion below expands — not the
           solver's 100 m segment count, which a single 1 km wall would inflate to ten. The
           wall-segment count lives on the capability card, next to the list it describes. -->
      <div class="flex items-center justify-center gap-1 py-1.5 px-1 rounded-xl bg-[#1b1c22] border border-[#2b2d33]">
        <span class="text-[9px] font-bold uppercase text-on-mono-dim">{obstacles.length ? `${obstacles.length} OBS` : 'CAT HC'}</span>
      </div>
    </div>
  </section>

  <!-- RIDE CAPABILITY (ROADMAP M4): can this rider hold the plan above? The same CP/W′
       engine as the race cockpit, asked over the whole route. Visual language follows the
       rider-approved Stitch reference: a striking crimson→black gradient deck (the one
       card on this page allowed to shout), a cockpit split — finding left, verdict pill
       right — an inset telemetry panel for evidence and provenance, then the route's
       obstacles as a divided accordion (climbs ≥ 3 % and walls, worst first).
       Adapted, not copied: fonts stay Plus Jakarta Sans with the app's `text-tabular`
       numbers (no second typeface), icons stay hugeicons, and status colours stay the
       cockpit triad #4ade9a/#ffb35a/#ff8a92 so this card and every StatusChip in the
       app speak one colour language. -->
  <section
    class="rounded-card p-5 flex flex-col text-white border border-white/10 bg-[linear-gradient(152deg,#b60100_0%,#870000_36%,#2e0208_76%,#12090b_100%)] shadow-[0_24px_56px_-12px_rgba(137,1,0,0.35),0_12px_32px_-8px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.18)]"
    data-test="ride-capability"
  >
    <header class="flex items-center justify-between gap-3 mb-4">
      <span class="flex items-center gap-2 min-w-0">
        <span class="h-1.5 w-1.5 rounded-pill bg-white shrink-0 shadow-[0_0_8px_rgba(255,255,255,0.8)]"></span>
        <span class="text-[11px] font-bold uppercase tracking-[0.16em] text-white/80">Ride capability</span>
      </span>
      <span class="flex items-center gap-1.5 shrink-0">
        <!-- Wall segments (solver 100 m steps, not features — the features are the rows
             below). Shown here rather than in the metric strip because it is evidence
             *about this plan's verdict*, and its count deliberately differs from the
             accordion's row count: one wall is many segments. -->
        {#if plan.ok && plan.powerLimitedCount}
          <span class="px-2 py-0.5 rounded-pill border border-white/15 bg-black/25 text-[10px] font-bold text-white/80 text-tabular">{plan.powerLimitedCount} WALL</span>
        {/if}
        <span class="px-2 py-0.5 rounded-pill border border-white/20 bg-black/25 text-[10px] font-bold text-white text-tabular">CP/W′</span>
      </span>
    </header>

    <!-- cockpit split: the finding anchors left, the verdict pill answers on the right.
         The headline has to say what fails and where on its own: "Plan power gives out"
         made a rider open this file to learn whose power, and "gives out" sat awkwardly
         next to a 100% W′ readout directly beneath it. Each branch now states the same
         fact the evidence line proves, in plain words, so the two never contradict. -->
    <div class="flex items-center justify-between gap-3 mb-4">
      <p class="min-w-0 pr-1 text-[14px] font-bold text-white leading-snug">
        {#if capability?.breakKm != null}
          You can’t hold this plan at <span class="text-[#ffb4a8] text-tabular font-extrabold whitespace-nowrap">km {capability.breakKm.toFixed(1)}</span>.
        {:else if capability?.verdict === 'sustainable'}
          You can hold this plan to the finish.
        {:else if capability?.verdict === 'unknown'}
          This route can’t be judged without your CP/W′.
        {:else}
          No plan to judge yet.
        {/if}
      </p>
      <span class="h-8 px-3 rounded-pill bg-black/40 border border-white/15 inline-flex items-center gap-1.5 shrink-0">
        <Icon name={verdictView.icon} size={14} strokeWidth={2.2} class={verdictView.cls} />
        <span class="text-[11.5px] font-extrabold uppercase tracking-wider leading-none {verdictView.cls}">{verdictView.word}</span>
      </span>
    </div>

    <!-- telemetry panel: the evidence for the verdict, and where the fit came from -->
    <div class="rounded-[14px] bg-black/45 border border-white/10 p-3.5 mb-4 flex flex-col gap-2.5">
      {#if capability?.verdict === 'unknown'}
        <p class="text-[11.5px] leading-relaxed text-white/80">
          No CP/W′ to judge against. Set the pair in Settings — a lab test, another app, or the estimate
          worked out from your FTP — and this card judges the route for real instead of taking the pace on faith.
        </p>
        <!--
          The verdict is the gap, so the way out of it belongs here, not three taps away: this
          row is the only place a rider meets "No CP fit" and can do something about it.
        -->
        <button
          class="h-9 self-start shrink-0 rounded-pill border border-white/20 bg-white/10 px-3.5 text-[10px] font-extrabold uppercase tracking-wider text-white active:scale-[0.98] transition-transform"
          onclick={() => route.navigate('settings')}
        >
          Set CP/W′
        </button>
      {:else if capability?.breakKm != null}
        <p class="text-[11.5px] leading-relaxed text-white/80">
          {capability.at.reason}. Needs <span class="font-bold text-white text-tabular">{capability.at.requiredW} W</span>
          {#if capability.at.availableW != null}
            — <span class="font-bold text-white text-tabular">{capability.at.availableW} W</span> available,
          {:else}
            — no CP to lean on,
          {/if}
          <span class="font-bold text-white text-tabular">{Math.round((capability.at.wPrimePct ?? 0) * 100)}%</span> W′ left.
        </p>
      {:else if capability}
        <p class="text-[11.5px] leading-relaxed text-white/80">
          {capability.at.reason}. Tightest at <span class="font-bold text-white text-tabular">km {capability.at.km.toFixed(1)}</span> —
          <span class="font-bold text-white text-tabular">{capability.at.requiredW} W</span> needed,
          {#if capability.at.availableW != null}
            <span class="font-bold text-white text-tabular">{capability.at.availableW} W</span> available,
          {:else}
            no CP to lean on,
          {/if}
          <span class="font-bold text-white text-tabular">{Math.round((capability.at.wPrimePct ?? 0) * 100)}%</span> W′ left.
        </p>
      {:else}
        <p class="text-[11.5px] leading-relaxed text-white/80">{plan.reason}</p>
      {/if}
      {#if cpFit}
        <p class="pt-2 border-t border-white/10 text-[10px] leading-relaxed text-white/55">
          <span class="text-white/85 font-semibold text-tabular">CP {cpFit.cp} W · W′ {(cpFit.wPrime / 1000).toFixed(1)} kJ</span>
          {#if cpFitEntered}
            — entered in Settings, not fitted
          {:else}
            — fit from <span class="text-white/85 font-medium text-tabular">{cpFit.points}</span> durations across <span class="text-white/85 font-medium text-tabular">{powerCurves.current?.length ?? 0}</span> rides
          {/if}
        </p>
      {/if}
    </div>

    {#if plan.ok}
      <div class="pt-3 border-t border-white/10 mb-1">
        <h2 class="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/70">Route obstacles</h2>
      </div>
      {#if obstacles.length === 0}
        <p class="text-[11px] text-white/60">
          Nothing steeper than 3% and nothing beyond target power on this plan — nothing to dodge.
        </p>
      {:else}
        <div class="flex flex-col divide-y divide-white/10">
        {#each (showAllObstacles ? obstacles : obstacles.slice(0, 8)) as obs (obs.startKm)}
          {@const st = obstacleStatus(obs.judgement)}
          <div>
            <button
              class="w-full py-3 flex items-center justify-between gap-3 text-left"
              aria-expanded={openObstacle === obs.startKm}
              onclick={() => (openObstacle = openObstacle === obs.startKm ? null : obs.startKm)}
            >
              <span class="flex items-center gap-2.5 min-w-0 flex-1">
                <span class="h-[22px] w-[22px] shrink-0 grid place-items-center rounded-[6px] bg-black/40 border border-white/10">
                  <Icon
                    name={obs.kind === 'wall' ? 'triangle-alert' : 'mountain'}
                    size={12}
                    strokeWidth={1.8}
                    class={st ? st.cls : 'text-white/75'}
                  />
                </span>
                <span class="min-w-0">
                  <span class="block text-[12px] font-bold text-white text-tabular leading-tight">
                    {obs.kind === 'wall' ? 'Wall' : 'Climb'} · km {obs.startKm.toFixed(1)}–{obs.endKm.toFixed(1)}
                  </span>
                  <span class="block text-[9.5px] font-medium uppercase tracking-wider text-white/60 text-tabular mt-0.5 truncate">
                    {obs.lengthKm.toFixed(1)} km · avg +{obs.avgGradePct.toFixed(1)}% · peak {obs.maxGradePct.toFixed(1)}%
                  </span>
                </span>
              </span>
              <span class="flex items-center gap-1.5 shrink-0 pl-1">
                {#if st}
                  <span class="text-[10px] font-extrabold uppercase tracking-tight {st.cls}">{st.word}</span>
                {/if}
                <Icon
                  name="chevron-right"
                  size={14}
                  strokeWidth={2}
                  class="shrink-0 transition-transform duration-200 {openObstacle === obs.startKm
                    ? `-rotate-90 ${st ? st.cls : 'text-white/70'}`
                    : 'rotate-90 text-white/50'}"
                />
              </span>
            </button>
            {#if openObstacle === obs.startKm}
              <!-- in:slide only — a slide OUTRO inside this keyed each leaks its node
                   (outro completes but Svelte never removes it, so panels pile up).
                   Open still animates; close removes the node in the same flush. -->
              <div in:slide={{ duration: 180 }} class="pb-3">
                <div class="rounded-[12px] bg-black/50 border border-white/10 p-3 mt-1 flex flex-col gap-1.5">
                  <p class="text-[11px] leading-relaxed text-white">
                    <span class="font-semibold">Tightest at km {tightestKmLabel(obs)}</span>
                    <span class="text-white/70"> · {obs.maxGradePct >= 0 ? '+' : ''}{obs.maxGradePct.toFixed(1)}% grade</span>:
                    needs <span class="font-bold text-tabular">{obs.judgement.requiredW} W</span>
                    {#if obs.judgement.availableW != null}
                      — <span class="font-bold text-tabular">{obs.judgement.availableW} W</span> available,
                      <span class="font-bold text-tabular">{Math.round((obs.judgement.wPrimePct ?? 0) * 100)}%</span> W′ left
                    {:else}
                      — no CP to lean on
                    {/if}.
                  </p>
                  <p class="text-[10.5px] leading-relaxed text-white/70">{obs.judgement.reason}.</p>
                </div>
              </div>
            {/if}
          </div>
        {/each}
        </div>
        {#if obstacles.length > 8}
          <!-- The note this replaces said "+N more features" and promised nothing. A
               toggle answers the question it raised, and collapsing returns to the
               worst 8 rather than the first 8 — the list is sorted worst-first. -->
          <button
            class="mt-2 h-9 w-full rounded-pill border border-white/15 bg-black/25 text-[10px] font-extrabold uppercase tracking-[0.12em] text-white/75 active:scale-[0.99] transition-transform"
            onclick={() => (showAllObstacles = !showAllObstacles)}
          >
            {showAllObstacles ? 'Show worst 8 only' : `Show all ${obstacles.length} features`}
          </button>
        {/if}
      {/if}
    {/if}
  </section>

  <!-- Elevation + solved speed, crosshair tooltip (UI-SPEC §21) -->
  <section class="rounded-card bg-surface border border-hairline p-4 flex flex-col relative overflow-hidden elevation-card">
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-1.5">
        <Icon name="chart-line" size={18} strokeWidth={1.5} class="text-signal" />
        <span class="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-dim">Profile &amp; speed</span>
        {#if !hasRoute}<span class="text-[9px] font-extrabold uppercase tracking-wider text-ink-dim bg-tile border border-hairline rounded-pill px-2 py-0.5">Sample</span>{/if}
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[10px] font-extrabold uppercase text-ink-dim">Solved</span>
        <span class="h-0.5 w-2 bg-signal"></span>
      </div>
    </div>

    <SpeedProfileChart points={chartRows} height={188} targetWatts={npTarget} />

    {#if !hasRoute}
      <p class="mt-1 text-[11px] font-medium text-ink-dim">
        Sample route — import a GPX to project against your own terrain.
      </p>
    {/if}
  </section>

  <!-- Dual grid: intensity + setup -->
  <section class="grid grid-cols-1 gap-2.5">
    <div class="rounded-card bg-surface border border-hairline p-4 flex flex-col gap-3.5">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-dim">Target intensity strategy</span>
      </div>
      <!-- two ways to name one target: watts by intensity, or the average speed you want -->
      <div class="grid grid-cols-2 gap-1 p-1 rounded-pill bg-canvas border border-hairline">
        <button
          class="py-2 rounded-pill transition-colors text-[10px] font-extrabold uppercase tracking-wider {targetType === 'power'
            ? 'bg-raised text-ink border border-signal/50'
            : 'text-ink-dim hover:text-ink border border-transparent'}"
          onclick={() => (targetType = 'power')}
        >
          Power
        </button>
        <button
          class="py-2 rounded-pill transition-colors text-[10px] font-extrabold uppercase tracking-wider {targetType === 'speed'
            ? 'bg-raised text-ink border border-signal/50'
            : 'text-ink-dim hover:text-ink border border-transparent'}"
          onclick={() => (targetType = 'speed')}
        >
          Avg speed
        </button>
      </div>

      {#if targetType === 'power'}
        <div class="grid grid-cols-3 gap-1 p-1 rounded-pill bg-canvas border border-hairline">
          {#each modes as m (m.name)}
            <button
              class="py-2 px-1 text-center rounded-pill transition-colors {Math.abs(targetIf - m.if) < 0.005
                ? 'bg-raised text-ink border border-signal/50 uppercase tracking-wider font-extrabold'
                : 'text-ink-dim hover:text-ink uppercase tracking-wider font-bold border border-transparent'} text-[10px] font-extrabold"
              onclick={() => (targetIf = m.if)}
            >
              {m.name}
              <span class="block text-[9px] {Math.abs(targetIf - m.if) < 0.005 ? 'text-crimson-deep' : 'text-ink-dim'} font-normal normal-case">IF {m.if.toFixed(2)}</span>
            </button>
          {/each}
        </div>
        <!-- the presets are three points on a continuum; this is the continuum -->
        <label class="flex flex-col gap-1">
          <span class="flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider text-ink-dim">
            <span>Manual IF</span>
            <span class="text-ink text-tabular">IF {targetIf.toFixed(2)} · {Math.round(targetIf * ftp)} W</span>
          </span>
          <input
            type="range"
            min="0.55"
            max="0.95"
            step="0.01"
            value={targetIf}
            oninput={(e) => (targetIf = Number((e.currentTarget as HTMLInputElement).value))}
            class="w-full accent-crimson"
            aria-label="Intensity factor"
          />
        </label>
      {:else}
        <label class="flex flex-col gap-1">
          <span class="flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider text-ink-dim">
            <span>Target avg speed</span>
            <span class="text-ink text-tabular">{targetSpeedKph.toFixed(1)} km/h</span>
          </span>
          <input
            type="range"
            min="15"
            max="45"
            step="0.5"
            value={targetSpeedKph}
            oninput={(e) => (targetSpeedKph = Number((e.currentTarget as HTMLInputElement).value))}
            class="w-full accent-crimson"
            aria-label="Target average speed"
          />
        </label>
        {#if speedFit?.note}
          <p class="text-[11px] font-bold text-warn">{speedFit.note}</p>
        {:else}
          <p class="text-[11px] text-ink-dim">
            Solves to <span class="font-bold text-ink">IF {pacingIf.toFixed(2)} · {npTarget} W</span> on this profile.
          </p>
        {/if}
      {/if}

      <div class="flex flex-col gap-1.5 pt-1">
        <div class="flex items-center justify-between">
          <span class="text-[13px] text-ink font-semibold">Normalized Power Target</span>
          <span class="text-[30px] leading-none text-crimson text-tabular font-extrabold">{npTarget} <span class="text-base font-normal text-ink-dim">W</span></span>
        </div>
        <!-- the bar itself is draggable in power mode: press and drag to set IF -->
        <div
          class="relative w-full h-3 bg-canvas rounded-pill overflow-hidden flex items-center border border-hairline touch-none {targetType === 'power'
            ? 'cursor-pointer'
            : ''}"
          {...(targetType === 'power'
            ? {
                role: 'slider',
                'aria-label': 'Power target bar',
                'aria-valuemin': 0.55,
                'aria-valuemax': 0.95,
                'aria-valuenow': Math.round(targetIf * 100) / 100,
                onpointerdown: (e: PointerEvent) => {
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  setIfFromBar(e);
                },
                onpointermove: (e: PointerEvent) => {
                  if (e.buttons > 0) setIfFromBar(e);
                }
              }
            : {})}
        >
          <div class="h-full bg-crimson rounded-pill glow-crimson transition-all" style="width: {barPct}%;"></div>
          <div class="absolute -translate-x-1/2 w-4 h-4 rounded-pill bg-ink border-2 border-signal transition-all" style="left: {barPct}%;"></div>
        </div>
        <div class="flex items-center justify-between text-ink-dim text-[10px] font-extrabold uppercase tracking-wider text-tabular px-0.5">
          <span>{Math.round(0.55 * ftp)} W (IF 0.55)</span>
          <span class="text-crimson-deep">FTP {ftp} W</span>
          <span>{Math.round(0.95 * ftp)} W (IF 0.95)</span>
        </div>
      </div>
    </div>
    <div class="rounded-card bg-surface border border-hairline p-4 flex flex-col justify-between gap-3 elevation-card">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-dim">Setup</span>
        <span class="text-[10px] font-extrabold uppercase text-aman">feeds the solver</span>
      </div>
      <div class="grid grid-cols-2 gap-2">
        {#each setupTiles as t (t.label)}
          <div class="p-2.5 rounded-2xl bg-raised border border-hairline flex flex-col gap-1">
            <div class="flex items-center gap-1.5 {t.tone === 'aman' ? 'text-aman' : 'text-signal'}">
              <Icon name={t.icon} size={16} strokeWidth={1.5} />
              <span class="text-[10px] font-extrabold uppercase tracking-wider text-ink-dim">{t.label}</span>
            </div>
            <span class="text-[11px] font-bold text-ink truncate text-tabular">{t.value}</span>
          </div>
        {/each}
      </div>

      <div class="flex flex-col gap-2.5 pt-1 border-t border-hairline">
        <label class="flex flex-col gap-1.5">
          <span class="flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider text-ink-dim">
            Cargo <span class="text-ink text-tabular">{cargoKg.toFixed(1)} kg</span>
          </span>
          <input
            type="range"
            min="0"
            max="10"
            step="0.5"
            value={cargoKg}
            oninput={(e) => (cargoKg = Number.parseFloat((e.currentTarget as HTMLInputElement).value))}
            class="w-full accent-crimson"
            aria-label="Cargo weight in kilograms"
          />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider text-ink-dim">
            Headwind
            <span class="text-ink text-tabular">
              {appliedHeadwind} km/h
              {#if windForecast && windBearing != null}
                <span class="text-ink-dim">· from forecast</span>
              {:else}
                <span class="text-ink-dim">· manual</span>
              {/if}
            </span>
          </span>
          <input
            type="range"
            min="0"
            max="40"
            step="1"
            value={headwindKph}
            oninput={(e) => (headwindKph = Number.parseInt((e.currentTarget as HTMLInputElement).value, 10))}
            class="w-full accent-crimson"
            aria-label="Headwind in kilometres per hour"
          />
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-1">
            <span class="text-[10px] font-extrabold uppercase tracking-wider text-ink-dim">Stops</span>
            <input
              type="number"
              min="0"
              max="6"
              value={stopCount}
              onchange={(e) => (stopCount = Math.max(0, Math.min(6, Number.parseInt((e.currentTarget as HTMLInputElement).value || '0', 10))))}
              class="h-9 rounded-xl bg-tile border border-hairline px-2.5 text-[13px] font-bold text-ink text-tabular outline-none focus:border-signal"
              aria-label="Number of stops"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-[10px] font-extrabold uppercase tracking-wider text-ink-dim">Minutes each</span>
            <input
              type="number"
              min="1"
              max="45"
              value={stopMin}
              onchange={(e) => (stopMin = Math.max(1, Math.min(45, Number.parseInt((e.currentTarget as HTMLInputElement).value || '15', 10))))}
              class="h-9 rounded-xl bg-tile border border-hairline px-2.5 text-[13px] font-bold text-ink text-tabular outline-none focus:border-signal"
              aria-label="Minutes per stop"
            />
          </label>
        </div>
        <label class="flex flex-col gap-1">
          <span class="text-[10px] font-extrabold uppercase tracking-wider text-ink-dim">Start time</span>
          <!-- The one number on this card that was a constant: every ETA, checkpoint clock
               and saved race start reads `startMin`, so this dial moves the whole plan. -->
          <input
            type="time"
            value={startClock}
            onchange={(e) => setStartClock((e.currentTarget as HTMLInputElement).value)}
            class="h-9 rounded-xl bg-tile border border-hairline px-2.5 text-[13px] font-bold text-ink text-tabular outline-none focus:border-signal"
            aria-label="Start time"
          />
        </label>
        {#if plan.hardest}
          <p class="text-[11px] font-medium text-ink-dim">
            Hardest at <span class="font-bold text-ink">km {plan.hardest.km.toFixed(1)}</span>
            — {plan.hardest.gradePct >= 0 ? '+' : ''}{plan.hardest.gradePct.toFixed(1)}% holds you to
            <span class="font-bold text-crimson-deep">{plan.hardest.vKph.toFixed(1)} km/h</span>.
          </p>
        {/if}
        {#if (plan.powerLimitedPct ?? 0) > 5}
          <div class="rounded-2xl border border-kritis/40 bg-kritis/5 p-3 flex flex-col gap-1">
            <p class="text-[11px] font-extrabold uppercase tracking-wider text-kritis">
              {plan.powerLimitedPct}% of the route is beyond {npTarget} W
            </p>
            <p class="text-[11px] font-medium text-ink-dim">
              The steepest ramp is {plan.steepestGradePct?.toFixed(1)}% and needs
              <span class="font-bold text-ink">{plan.peakRequiredW} W</span> just to hold 15 km/h.
              Drop headwind/cargo or lift the target — as set, this plan is not rideable.
            </p>
          </div>
        {:else if (plan.avgKph ?? 0) > 0 && (plan.avgKph ?? 0) < 15}
          <div class="rounded-2xl border border-warn/40 bg-warn/5 p-3 flex flex-col gap-1">
            <p class="text-[11px] font-extrabold uppercase tracking-wider text-warn">
              Plan averages {plan.avgKph?.toFixed(1)} km/h — too slow to be credible
            </p>
            <p class="text-[11px] font-medium text-ink-dim">
              The maths is solvable, but nobody rides this at {plan.avgKph?.toFixed(1)} km/h.
              Wind and load dominate: try easing headwind or cargo.
            </p>
          </div>
        {/if}
      </div>
    </div>
  </section>

  <!-- WIND FORECAST (ROADMAP M5 DoD line 4) -->
  <section class="rounded-card bg-surface border border-hairline p-4 flex flex-col gap-3 elevation-card">
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="h-9 w-9 rounded-pill bg-tile grid place-items-center border border-hairline">
          <Icon name="sun" size={17} strokeWidth={1.5} class="text-ink" />
        </div>
        <div class="flex flex-col">
          <span class="text-[11px] font-bold uppercase tracking-[0.08em] text-ink">Wind forecast</span>
          <span class="text-[11px] text-ink-dim">Open-Meteo, hourly, no key</span>
        </div>
      </div>
      <button
        class="h-9 px-4 rounded-pill border border-hairline-strong text-ink font-extrabold uppercase text-[10px] tracking-wider active:scale-[0.98] transition-transform disabled:opacity-50"
        disabled={windBusy}
        onclick={loadForecast}
      >
        {windBusy ? 'Loading…' : windForecast ? 'Reload' : 'Load'}
      </button>
    </div>

    {#if windNote}
      <p class="text-[12px] leading-relaxed text-ink-dim">{windNote}</p>
    {/if}

    {#if windForecast && windBearing != null}
      <div class="flex items-center justify-between text-[11px] font-bold text-ink-dim pt-1 border-t border-hairline">
        <span>ROUTE BEARING <span class="text-ink">{Math.round(windBearing)}°</span></span>
        <span class="text-ink-dim/40">·</span>
        {#if peakForecast && peakForecast.kph > 0}
          <span>PEAK <span class="text-crimson">{peakForecast.kph} km/h</span> at h+{peakForecast.hourIndex}</span>
        {:else}
          <span>PEAK <span class="text-aman">tailwind or calm</span></span>
        {/if}
      </div>
      {#if peakForecast && peakForecast.kph > 15}
        <p class="text-[12px] leading-relaxed text-warn">
          Wind builds to {peakForecast.kph} km/h on the nose around hour {peakForecast.hourIndex}. That is the
          stretch to budget bottles for, not the average.
        </p>
      {/if}
    {:else if windForecast}
      <p class="text-[12px] leading-relaxed text-ink-dim">
        Forecast loaded, but no track bearing yet — the headwind above stays on manual until a GPX supplies one.
      </p>
    {/if}
  </section>

  <!-- BEST START: the weather-aware departure picker (Open-Meteo + the rider's own speed) -->
  {#if hasRoute}
    <section class="rounded-card bg-surface border border-hairline p-4 flex flex-col gap-3 elevation-card">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="h-9 w-9 rounded-pill bg-tile grid place-items-center border border-hairline">
            <Icon name="clock" size={17} strokeWidth={1.5} class="text-ink" />
          </div>
          <div class="flex flex-col">
            <span class="text-[11px] font-bold uppercase tracking-[0.08em] text-ink">Best start</span>
            <span class="text-[11px] text-ink-dim">Open-Meteo · ETA from your rides</span>
          </div>
        </div>
        <button
          class="h-9 px-4 rounded-pill border border-hairline-strong text-ink font-extrabold uppercase text-[10px] tracking-wider active:scale-[0.98] transition-transform disabled:opacity-50"
          disabled={departBusy}
          onclick={findBestStart}
        >
          {departBusy ? 'Scoring…' : departOptions.length > 0 ? 'Refresh' : 'Find'}
        </button>
      </div>

      {#if departNote}
        <p class="text-[12px] leading-relaxed text-ink-dim">{departNote}</p>
      {/if}

      {#if departOptions.length > 0}
        <!-- one pill per departure hour; the strip scrolls (same convention as Settings) -->
        <div
          class="flex gap-1.5 overflow-x-auto scrollbar-none pt-2.5 border-t border-hairline"
          role="group"
          aria-label="Departure hours"
        >
          {#each departOptions as o, idx (o.hourIndex)}
            <button
              class="shrink-0 h-14 min-w-[64px] px-3 rounded-2xl border flex flex-col items-center justify-center gap-0.5 transition-colors {departPicked === idx
                ? 'bg-ink text-on-mono border-ink'
                : idx === departBest
                  ? 'bg-signal/10 border-signal text-ink'
                  : 'bg-tile border-hairline text-ink-dim'}"
              aria-pressed={departPicked === idx}
              aria-label={`${o.startClock} departure, ${Math.round(o.tempC)} degrees, ${o.rainPct} percent rain${idx === departBest ? ', best start' : ''}`}
              onclick={() => pickDeparture(idx)}
            >
              <span class="text-[13px] font-extrabold text-tabular leading-none">{o.startClock}</span>
              <span class="text-[9px] font-bold text-tabular leading-none">{Math.round(o.tempC)}° · {o.rainPct}%</span>
              {#if idx === departBest}
                <span
                  class="text-[8px] font-extrabold uppercase tracking-wider leading-none {departPicked === idx
                    ? 'text-rose'
                    : 'text-crimson-deep'}">Best</span
                >
              {/if}
            </button>
          {/each}
        </div>

        {#if departPicked != null && departOptions[departPicked]}
          {@const o = departOptions[departPicked]}
          <p class="text-[12px] leading-relaxed text-ink-dim">
            Roll out <span class="font-bold text-ink">{o.startClock}</span> → home
            <span class="font-bold text-ink">{o.finishClock}{o.finishesNextDay ? ' (+1d)' : ''}</span>
            · <span class="font-bold text-ink">{o.durationH.toFixed(1)} h</span>
            · {o.rainPct}% rain · {#if o.headwindKph > 0}<span class="font-bold text-crimson-deep"
              >{o.headwindKph} km/h head</span
            >{:else if o.headwindKph < 0}<span class="font-bold text-aman"
              >{Math.abs(o.headwindKph)} km/h push</span
            >{:else}no wind applied{/if}
          </p>
        {/if}

        <div class="rounded-xl bg-tile p-3 text-[11px] font-bold text-ink">
          <span class="uppercase text-ink-dim">Evidence:</span> {departEvidence}
        </div>
      {/if}
    </section>
  {/if}

  <!-- Checkpoints -->
  <section>
    <div class="flex items-start justify-between gap-2 mb-2">
      <div class="flex items-start gap-1.5 min-w-0">
        <Icon name="flag" size={18} strokeWidth={1.5} class="text-signal shrink-0 mt-px" />
        <!-- the break is deliberate: at 11 px the full phrase wraps wherever it likes and
             races the badge for width; two fixed lines make the stack the design -->
        <span class="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-dim leading-snug">
          Checkpoints &amp;<br />control points
        </span>
      </div>
      <span class="shrink-0 whitespace-nowrap text-[10px] font-extrabold uppercase text-aman px-2 py-0.5 rounded bg-aman/10 border border-aman/30 self-start">
        solved from physics
      </span>
    </div>
    <div class="grid grid-cols-1 gap-2">
      {#each waypoints as w, i (i)}
        <div class="rounded-2xl bg-surface border border-hairline p-3 flex items-center justify-between gap-2 hover:border-hairline-strong transition-colors">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <!-- km commits on blur/Enter (not per keystroke): typing "12" on the way to
                 "120" must not re-solve the whole plan mid-word.
                 One line, not a stack: a native number input sprouts spinners in Chromium
                 that steal width and shove the digits sideways, so every row used to sit at
                 a different offset. The spinner buttons are stripped, the figure is
                 right-aligned in tabular figures so decimals stack down the column, and the
                 KM unit holds a fixed spot beside it. The crimson tint marks the kilometre
                 as the one number on this row worth a glance. -->
            <div
              class="w-[68px] h-10 shrink-0 rounded-xl bg-crimson/8 border border-crimson/25 flex items-center justify-center gap-1 px-2"
            >
              <input
                type="number"
                inputmode="decimal"
                min="0"
                max={routeKm}
                step="0.1"
                value={w.km}
                onchange={(e) => cpSetKm(i, (e.currentTarget as HTMLInputElement).value)}
                class="w-full min-w-0 bg-transparent text-right text-[11px] font-bold text-ink text-tabular leading-none outline-none focus:text-crimson-deep py-1.5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                aria-label={`Checkpoint ${i + 1} kilometres`}
              />
              <span class="text-[8px] font-extrabold text-crimson-deep uppercase tracking-wider shrink-0">KM</span>
            </div>
            <div class="flex flex-col min-w-0 flex-1 gap-0.5">
              <input
                type="text"
                value={w.label}
                oninput={(e) => cpPatch(i, { label: (e.currentTarget as HTMLInputElement).value })}
                class="w-full min-w-0 bg-transparent rounded-lg px-1.5 py-1 font-semibold text-ink text-sm outline-none border border-transparent focus:border-hairline-strong focus:bg-canvas"
                aria-label={`Checkpoint ${i + 1} label`}
              />
              {#if w.grade}
                <span class="text-[9px] font-extrabold uppercase tracking-wider text-ink-dim px-1.5 truncate">
                  {w.grade}
                </span>
              {/if}
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <div class="flex flex-col items-end text-tabular">
              <span class="text-xs font-bold text-ink">{w.eta}</span>
              <span class="text-[10px] text-ink-dim">{w.elapsed}</span>
            </div>
            <button
              class="h-8 w-8 rounded-pill bg-raised border border-hairline grid place-items-center text-ink-dim hover:text-kritis hover:border-kritis/40 transition-colors"
              onclick={() => cpRemove(i)}
              aria-label={`Remove checkpoint ${i + 1}`}
            >
              <Icon name="trash" size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      {/each}
    </div>
    <div class="flex gap-2 mt-2">
      <button
        class="flex-1 h-10 rounded-pill bg-surface border border-hairline-strong text-ink font-extrabold uppercase text-[10px] tracking-wider flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
        onclick={cpAdd}
      >
        <Icon name="plus" size={14} strokeWidth={2} />
        Add checkpoint
      </button>
      {#if customCheckpoints != null}
        <button
          class="h-10 px-4 rounded-pill bg-tile border border-hairline text-ink-dim font-extrabold uppercase text-[10px] tracking-wider flex items-center gap-1.5 active:scale-[0.98] transition-transform"
          onclick={cpReset}
          aria-label="Reset checkpoints to derived"
        >
          <Icon name="rotate-ccw" size={13} strokeWidth={1.5} />
          Auto
        </button>
      {/if}
    </div>
  </section>

  <button
    class="w-full h-14 rounded-pill bg-crimson-fill text-white text-sm tracking-wider uppercase font-black flex items-center justify-center gap-2 glow-signal active:scale-[0.98] transition-all"
    onclick={saveAsRacePlan}
  >
    <Icon name="flag" size={20} strokeWidth={1.5} />
    Save as race plan
  </button>
</div>

