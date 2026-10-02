<script lang="ts">
  import EditorialHeader from '$lib/components/EditorialHeader.svelte';
  import SectionCard from '$lib/components/SectionCard.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import HatchTrack from '$lib/components/HatchTrack.svelte';
  import { allBikes, fetchRouteProfile, latestFtp, powerCurves, weightSeries } from '$lib/data/queries.svelte';
  import { db, type Race, type RaceCheckpoint, type RaceLog } from '$lib/data/db';
  import { newId } from '$lib/data/seed';
  import { liveQuery } from 'dexie';
  import SpeedProfileChart from '$lib/components/SpeedProfileChart.svelte';
import { buildPlan, clockOf, planSeries, slowestWindows, type PlanSeriesPoint } from '$lib/domain/pacing';
import {
  gateBufferAt,
  kmAtClock as kmAtClockAt,
  planMinutesBetween,
  sustainAt,
  wPrimeSpentAt,
  type CutoffGate
} from '$lib/domain/race';
import { fitCriticalPower, mergePowerCurves } from '$lib/domain/power-curve';
import type { PhysicsParams, ProfilePoint } from '$lib/domain/physics';
  import {
    ChevronLeft,
    Lock,
    Check,
    Timer,
    Plus,
    Trash2,
    Luggage,
    Coffee,
    Pencil,
    ChevronRight,
    Minus,
    Mountain,
    ShieldAlert,
    Activity,
    Flag
  } from '@lucide/svelte';

  // ---------- setup state (persisted to Dexie) ----------
  let raceId = $state<string | null>(null);
  let liveMode = $state(false);

  let name = $state('Bukit Barisan 200');
  let startMin = $state(5 * 60 + 30);
  let cutoffMin = $state(13 * 60);
  let ifTarget = $state(0.7);
  let cargoKg = $state(3);
  let stopsMin = $state(30);
  let selectedBikeId = $state<string | null>(null);
  let checkpoints = $state<RaceCheckpoint[]>([{ km: 120, cutoffMin: 570, label: 'CP2 Payakumbuh' }]);
  /** stored GPX route backing this race — null until a race/route row is resolved */
  let routeId = $state<string | null>(null);

  const bikes = $derived(allBikes.current ?? []);
  $effect(() => {
    if (!selectedBikeId && bikes.length > 0) selectedBikeId = bikes.find((b) => b.active)?.id ?? bikes[0].id;
  });

  // Load an existing planned/live race once
  void (async () => {
    try {
      const existing = await db.races.where('status').anyOf(['planned', 'live']).toArray();
      if (existing.length > 0) {
        const r = existing[0];
        raceId = r.id;
        name = r.name;
        liveMode = r.status === 'live';
        const d = new Date(r.startTime);
        startMin = d.getHours() * 60 + d.getMinutes();
        cutoffMin = r.cutoffFinishMin;
        checkpoints = r.checkpoints;
        routeId = r.routeId;
      }
    } catch (err) {
      console.error('[gowslab] race load failed:', err);
    }
  })();

  // ---------- derived (setup) ----------
  const ftp = $derived(latestFtp.current?.ftp ?? 0);
  const targetWatts = $derived(Math.round(ifTarget * ftp));
  const fmtClock = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;
  const cutoffClock = $derived(fmtClock(startMin + cutoffMin));
  const ifDesc = $derived(ifTarget < 0.65 ? 'Recovery / Zone 1' : ifTarget < 0.76 ? 'Steady Endurance' : ifTarget < 0.85 ? 'Tempo Pacing' : 'Sweetspot / Threshold');
  const ifTone = $derived(ifTarget < 0.65 ? 'text-ink-dim' : ifTarget < 0.76 ? 'text-aman' : ifTarget < 0.85 ? 'text-crimson-deep' : 'text-kritis');

  // Every number on this page comes out of `racePlan` below — the solver walking the real
  // GPX profile at the rider's chosen intensity. There are deliberately no average-speed or
  // distance constants left: a "200.4 km / 30 km/h" shortcut is a number that cannot react
  // to the profile, the cargo or the power the rider just dialled in, and it silently
  // contradicts the chart sitting two cards below it.

  // ---------- route profile + solved plan (shared by setup and live chart, §23) ----------
  let profile = $state<ProfilePoint[]>([]);
  const riderKg = $derived(weightSeries.current?.at(-1)?.kg ?? 68);
  const bike = $derived(bikes.find((b) => b.id === selectedBikeId));

  // load the stored GPX profile once per race; [] means "no route loaded" and the chart
  // then says so instead of drawing a made-up hill
  $effect(() => {
    const id = routeId;
    let cancelled = false;
    void fetchRouteProfile(id ?? undefined).then((pts) => {
      if (!cancelled) profile = pts;
    });
    return () => {
      cancelled = true;
    };
  });

  const raceKm = $derived(profile.at(-1)?.distKm ?? 0);

  /**
   * One physics block, shared by the plan builder and the W' feasibility check. If these
   * ever drift apart the cockpit would judge the rider against a different bike than the
   * one it planned with, and the two answers would quietly disagree.
   */
  const racePhysics = $derived<PhysicsParams>({
    riderKg,
    bikeKg: bike?.weightKg ?? 9.4,
    cargoKg,
    crr: bike?.crr ?? 0.0045,
    cda: bike?.cda ?? 0.32,
    temperatureC: 20
  });

  /**
   * CP/W' fitted from every activity that carries power — the same merged mean-max curve
   * the dashboard uses. Null when the athlete has no power rides yet, which is an honest
   * "cannot judge" rather than a guess.
   */
  const cpFit = $derived.by(() => {
    const merged = mergePowerCurves((powerCurves.current ?? []).map((c) => c.points));
    return merged.length >= 4 ? fitCriticalPower(merged) : undefined;
  });

  const racePlan = $derived(
    profile.length >= 2
      ? buildPlan({
        profile,
        physics: racePhysics,
        pacing: { mode: 'if', ifTarget, ftp },
        stops: { count: stopsMin > 0 ? Math.max(1, Math.round(stopsMin / 15)) : 0, minutesEach: 15 },
        startMin,
        // vMax capped for racing: a descent is taken at control speed, not at the free-ride cap
        vMaxKph: 55,
        checkpoints: checkpoints.map((c) => ({ km: c.km, label: c.label, cutoffMin: c.cutoffMin }))
      })
      : null
  );

  /** Chart rows: the same solver output the crosshair reads its buffer from. */
  const chartRows = $derived<PlanSeriesPoint[]>(racePlan ? planSeries(racePlan) : []);
  const gates = $derived<CutoffGate[]>([
    ...checkpoints.filter((c) => c.cutoffMin != null).map((c) => ({ km: c.km, cutoffMin: c.cutoffMin!, label: c.label })),
    { km: raceKm, cutoffMin, label: 'Finish' }
  ]);
  const chartMarkers = $derived(
    // short label only: the gate name and its buffer already live in the chip and tooltip
    gates.map((g) => ({ km: g.km, label: clockOf(startMin + g.cutoffMin), tone: 'neutral' as const }))
  );
  /** what the crosshair is currently reporting, or null when it is off the plot */
  let probeKm = $state<number | null>(null);
  const probe = $derived(probeKm != null ? gateBufferAt(chartRows, gates, probeKm) : null);
  /**
   * Can the plan pace at the crosshair still be held? This is the M4 question the pacing
   * model alone cannot answer: the solver assumes the target is sustainable from a full
   * tank, and this asks what is left of it.
   *
   * W′ is charged by work above CP along the solved segments (`wPrimeSpentAt`), and the
   * remaining reserve is spread over the stretch this pace still has to be held — the next
   * cut-off ahead, not the whole race. A pace that must last five minutes and one that must
   * last five hours draw on the same tank very differently.
   */
  const probeSustain = $derived.by(() => {
    const km = probeKm;
    if (km == null) return null;
    const spent = racePlan?.solution && cpFit ? wPrimeSpentAt(racePlan.solution.segments, cpFit, km) : 0;
    const gateKm = gates.find((g) => g.km >= km)?.km ?? raceKm;
    const holdMin = planMinutesBetween(chartRows, km, gateKm) ?? 600;
    return sustainAt(chartRows, km, racePhysics, cpFit, cpFit ? spent : 0, holdMin * 60);
  });

  // ---------- setup preview: the plan, not a guess ----------
  /** true once the solver produced a usable plan — every number below needs one */
  const hasPlan = $derived(racePlan?.ok === true && raceKm > 0);
  /** total plan duration in minutes, stops included */
  const planMin = $derived(hasPlan ? (racePlan?.elapsedSec ?? 0) / 60 : null);
  const planTotal = $derived(planMin != null ? fmtDur(planMin) : '—');
  const planEta = $derived(planMin != null ? fmtClock(startMin + planMin) : '—');
  const planAvgKph = $derived(racePlan?.avgKph ?? null);
  const planClimbM = $derived(racePlan?.climbM ?? null);
  /** slack of the whole plan against the finish cut-off, minutes */
  const bufferMin = $derived(planMin != null ? Math.round(cutoffMin - planMin) : null);

  /**
   * Where the energy actually goes. These were three hard-coded sector names with grades
   * and times that were never solved; a "where it hurts" card has to come from the same
   * solver as the finish estimate or it will happily contradict it.
   */
  const slowestSectors = $derived(
    (racePlan?.solution ? slowestWindows(racePlan.solution, 3, 10) : []).map((w, i) => ({
      name: `KM ${Math.round(w.fromKm)}–${Math.round(w.toKm)}`,
      km: w.km,
      grade: `${w.gradePct >= 0 ? '+' : ''}${w.gradePct.toFixed(1)}%`,
      mins: Math.round(w.mins),
      watts: Math.round(w.watts),
      kph: w.kph,
      tone: (['signal', 'aman', 'dim'] as const)[i] ?? 'dim'
    }))
  );

  async function saveAndStart() {
    try {
      const routeStub = await db.routes.toArray();
      const routeIdRef = routeStub[0]?.id ?? 'stub-route';
      routeId = routeIdRef;
      // plain objects only: Dexie/IndexedDB cannot structured-clone $state proxies
      const plainCheckpoints: RaceCheckpoint[] = JSON.parse(JSON.stringify(checkpoints));
      if (!raceId) {
        raceId = newId();
        const race: Race = {
          id: raceId,
          routeId: routeIdRef,
          name,
          startTime: new Date(new Date().setHours(0, 0, 0, 0) + startMin * 60000).toISOString(),
          cutoffFinishMin: cutoffMin,
          checkpoints: plainCheckpoints,
          planJson: JSON.stringify({ ifTarget, cargoKg, stopsMin, bikeId: selectedBikeId }),
          status: 'live',
          updatedAt: Date.now()
        };
        await db.races.put(race);
      } else {
        // re-starting re-binds the route as well: the rider may have imported the GPX after
        // the race was first created, and a stale 'stub-route' would blank the course chart
        await db.races.update(raceId, {
          name,
          status: 'live',
          routeId: routeIdRef,
          checkpoints: plainCheckpoints,
          planJson: JSON.stringify({ ifTarget, cargoKg, stopsMin, bikeId: selectedBikeId }),
          updatedAt: Date.now()
        });
      }
      enterLive();
    } catch (err) {
      console.error('[gowslab] saveAndStart failed:', err);
    }
  }

  // ---------- live mode (PRD F7: input km → buffer, proyeksi, required pace) ----------
  let logs = $state<RaceLog[]>([]);
  let kmInput = $state('');
  let now = $state(Date.now());
  let wakeLock: unknown = null;

  $effect(() => {
    if (!liveMode) return;
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  $effect(() => {
    const id = raceId;
    if (!id || !liveMode) {
      logs = [];
      return;
    }
    const sub = liveQuery(() => db.race_logs.where('raceId').equals(id).sortBy('at')).subscribe({
      next: (rows) => (logs = rows),
      error: (e) => console.error('[gowslab] race_logs liveQuery error:', e)
    });
    return () => sub.unsubscribe();
  });

  async function requestWakeLock(): Promise<void> {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request: (type: string) => Promise<unknown> } }).wakeLock;
      if (wl) wakeLock = await wl.request('screen');
    } catch {
      /* wake-lock is best-effort */
    }
  }

  function releaseWakeLock(): void {
    try {
      (wakeLock as { release?: () => Promise<void> } | null)?.release?.();
    } catch {
      /* noop */
    }
    wakeLock = null;
  }

  function enterLive(): void {
    liveMode = true;
    void requestWakeLock();
  }

  async function backToSetup(): Promise<void> {
    if (raceId) await db.races.update(raceId, { status: 'planned', updatedAt: Date.now() });
    releaseWakeLock();
    liveMode = false;
  }

  const startTimeMs = $derived(new Date(new Date().setHours(0, 0, 0, 0) + startMin * 60000).getTime());
  const elapsedMin = $derived(Math.max(0, (now - startTimeMs) / 60000));
  const clockNow = $derived(fmtClock(startMin + elapsedMin));
  const lastLog = $derived(logs.at(-1));

  const kmAtClock = $derived.by(() => {
    if (lastLog) return Math.min(lastLog.km, raceKm);
    // No checkpoint logged yet: ask the plan where this clock time lands us, instead of
    // assuming a constant average speed. That keeps the live marker on the same solved
    // curve as the chart, and it is the only way the hero can mean anything before the
    // first tap.
    const fromPlan = kmAtClockAt(chartRows, startMin + elapsedMin);
    return fromPlan == null ? 0 : Math.max(0, Math.min(raceKm, fromPlan));
  });

  /**
   * The same judgement at the rider's current position, not the hovered one. The horizon is
   * the ride to the finish: that is how long the plan pace has to survive.
   */
  const nowSustain = $derived.by(() => {
    if (!hasPlan) return null;
    const spent = racePlan?.solution && cpFit ? wPrimeSpentAt(racePlan.solution.segments, cpFit, kmAtClock) : 0;
    const holdMin = planMinutesBetween(chartRows, kmAtClock, raceKm) ?? 600;
    return sustainAt(chartRows, kmAtClock, racePhysics, cpFit, cpFit ? spent : 0, holdMin * 60);
  });

  const avgSpeed = $derived.by(() => {
    if (lastLog) {
      const h = Math.max(1 / 60, (lastLog.at - startTimeMs / 1000) / 3600);
      return Math.round((lastLog.km / h) * 10) / 10;
    }
    return planAvgKph == null ? null : Math.round(planAvgKph * 10) / 10;
  });

  /**
   * Plan minutes still ahead of the rider, stops included.
   *
   * This is the honest projection: the remaining route is walked through the solved curve
   * from wherever the rider actually is. The previous version derived the projected finish
   * from the *required* pace, and the required pace was itself derived from the time left
   * to the cut-off — so the two cancelled out and the hero read `+0h 00m BUFFER` on every
   * race, always. A buffer measured against itself is not a measurement.
   */
  const planMinToGo = $derived(planMinutesBetween(chartRows, kmAtClock, raceKm));
  const finishMin = $derived(planMinToGo == null ? null : startMin + elapsedMin + planMinToGo);
  const finishClock = $derived(finishMin == null ? '—' : fmtClock(finishMin));
  /** positive = projected to arrive before the cut-off; null when there is no plan */
  const buffer = $derived(finishMin == null ? null : Math.round(startMin + cutoffMin - finishMin));

  /** what the rider must hold from here to make the cut-off, km/h */
  const hoursLeft = $derived(Math.max(0.05, (cutoffMin - elapsedMin) / 60));
  const reqPace = $derived(Math.max(0, Math.round(((raceKm - kmAtClock) / hoursLeft) * 10) / 10));

  // checkpoint cut-offs share the same projection, so they can never disagree with the hero
  const cpBuffers = $derived(
    checkpoints
      .filter((c) => c.cutoffMin != null)
      .map((c) => {
        const left = planMinutesBetween(chartRows, kmAtClock, c.km);
        const etaMin = left == null ? null : startMin + elapsedMin + left;
        return {
          ...c,
          buffer: etaMin == null ? null : Math.round(startMin + (c.cutoffMin ?? 0) - etaMin)
        };
      })
      .sort((a, b) => (a.buffer ?? 0) - (b.buffer ?? 0))
  );
  const worstCp = $derived(cpBuffers.find((c) => c.buffer != null));

  const cpStatus = (m: number) => (m >= 20 ? 'aman' : m >= 0 ? 'waspada' : 'kritis') as 'aman' | 'waspada' | 'kritis';
  const status = $derived.by(() => {
    // no plan means no verdict — "unknown" must not read as "safe"
    if (buffer == null) return 'unknown' as const;
    // 'unknown' is deliberately not a verdict: it means the plan could not be solved, so the
    // UI must not paint a green "ahead of target" that nobody has evidence for.
    const cpB = worstCp?.buffer;
    if (buffer < 0 || (cpB != null && cpB < 0)) return 'kritis' as const;
    if (buffer < 20 || (cpB != null && cpB < 20)) return 'waspada' as const;
    return 'aman' as const;
  });
  // F7-AC3: required pace beyond current capability flips the copy to a critical message
  const paceRealistic = $derived(avgSpeed == null ? true : reqPace <= avgSpeed * 1.15 || (buffer ?? 0) >= 45);
  const statusMsg = $derived(
    status === 'unknown'
      ? 'No route profile loaded — import a GPX to project a finish against the cut-off.'
      : status === 'kritis'
        ? 'Cut-off at risk — required pace above what the clock allows.'
        : !paceRealistic
          ? 'Required pace is above your current average — consider easing stops.'
          : 'Required pace is within reach of your current average.'
  );

  const bufferLabel = $derived(
    buffer == null
      ? '—'
      : `${buffer >= 0 ? '+' : '−'}${Math.floor(Math.abs(buffer) / 60)}h ${String(Math.abs(buffer) % 60).padStart(2, '0')}m`
  );
  const progressPct = $derived(Math.min(1, Math.max(0, kmAtClock / Math.max(raceKm, 0.1))));
  const kmLogged = $derived(logs.length > 0);

  async function logCheckpoint(): Promise<void> {
    const km = Number.parseFloat(kmInput);
    if (!raceId || !Number.isFinite(km) || km < 0 || km > 500) return;
    try {
      const entry: RaceLog = { id: newId(), raceId, at: Math.round(Date.now() / 1000), km, updatedAt: Date.now() };
      await db.race_logs.put(entry);
      kmInput = '';
    } catch (err) {
      console.error('[gowslab] logCheckpoint failed:', err);
    }
  }

  async function finishRace(): Promise<void> {
    if (!raceId) return;
    try {
      const r = await db.races.get(raceId);
      const plan = r?.planJson ? (JSON.parse(r.planJson) as Record<string, unknown>) : {};
      plan.actualFinishMin = Math.round(elapsedMin);
      plan.actualKm = kmAtClock;
      plan.actualBufferMin = buffer;
      await db.races.update(raceId, { status: 'finished', planJson: JSON.stringify(plan), updatedAt: Date.now() });
      releaseWakeLock();
      liveMode = false;
      raceId = null;
    } catch (err) {
      console.error('[gowslab] finishRace failed:', err);
    }
  }

  function fmtDur(min: number): string {
    const h = Math.floor(min / 60);
    return `${h}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;
  }
</script>

<div class="mx-auto max-w-md px-5 pt-8 pb-10 flex flex-col gap-5">
  {#if !liveMode}
    <!-- ============ RACE SETUP (UI-SPEC §4.7) ============ -->
    <EditorialHeader
      kicker="New race"
      headline="Race setup"
      sub="Configure telemetry, pacing model —"
      accent="and tactical cut-offs."
    />

    <!-- Race name -->
    <section class="bg-surface border border-hairline p-4 rounded-card elevation-card flex flex-col gap-2">
      <label class="text-[11px] font-bold tracking-wider uppercase text-ink-dim" for="race-name">Race name</label>
      <div class="h-11 bg-raised rounded-2xl px-3.5 flex items-center justify-between border border-hairline-strong/60 focus-within:border-signal transition-colors">
        <input
          id="race-name"
          class="bg-transparent border-0 outline-none text-ink font-bold w-full p-0 text-base"
          type="text"
          bind:value={name}
        />
        <Pencil size={18} strokeWidth={1.5} class="text-ink-dim shrink-0 ml-2" />
      </div>
    </section>

    <!-- Route card -->
    <section class="bg-surface border border-hairline p-4 rounded-card elevation-card flex flex-col gap-2.5">
      <span class="text-[11px] font-bold tracking-wider uppercase text-ink-dim">Route profile</span>
      <div class="flex items-center justify-between gap-3 bg-raised p-3 rounded-2xl border border-hairline">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-14 h-12 bg-canvas rounded-lg flex items-center justify-center relative overflow-hidden shrink-0 border border-hairline-strong">
            <svg class="w-full h-full p-1" preserveAspectRatio="none" viewBox="0 0 100 60">
              <path d="M 5,45 Q 25,50 40,25 T 70,15 T 95,38" fill="none" stroke="#e8102e" stroke-linecap="round" stroke-width="2.5" />
              <path d="M 5,45 Q 25,50 40,25 T 70,15 T 95,38 L 95,60 L 5,60 Z" fill="rgba(232,16,46,0.12)" />
              <circle cx="40" cy="25" fill="#ff4d5e" r="3" />
            </svg>
          </div>
          <div class="flex flex-col min-w-0">
            <h3 class="text-sm font-bold text-ink truncate">{name}</h3>
            <p class="text-xs text-ink-dim text-tabular mt-0.5">{raceKm > 0 ? `${raceKm.toFixed(1)} km` : 'no profile'} · <span class="text-aman">{planClimbM == null ? '—' : `${Math.round(planClimbM).toLocaleString('id-ID')} m`} ↑</span></p>
          </div>
        </div>
        <a
          href="#/routes"
          class="text-crimson-deep text-[11px] font-bold tracking-wider uppercase flex items-center gap-0.5 shrink-0 px-2 py-1.5 rounded-lg bg-surface border border-hairline-strong hover:bg-hairline transition-all"
        >
          Change <ChevronRight size={14} strokeWidth={1.5} />
        </a>
      </div>
    </section>

    <!-- Time steppers (2-col) -->
    <div class="grid grid-cols-2 gap-3">
      <section class="bg-surface border border-hairline p-3.5 rounded-card elevation-card flex flex-col justify-between">
        <div class="flex flex-col gap-1">
          <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Start time</span>
          <span class="text-[9px] font-bold text-aman">WIB (UTC+7)</span>
        </div>
        <div class="py-2.5">
          <span class="text-3xl font-extrabold text-ink tracking-tight text-tabular">{fmtClock(startMin)}</span>
          <span class="text-[10px] text-ink-dim block truncate">Scheduled dawn roll-out</span>
        </div>
        <div class="flex items-center gap-2 pt-1 border-t border-hairline/60">
          <button class="flex-1 h-9 rounded-xl bg-raised hover:bg-hairline border border-hairline-strong text-ink grid place-items-center transition-all" onclick={() => (startMin = (startMin + 1425) % 1440)} aria-label="Decrease start time">
            <Minus size={18} strokeWidth={1.5} />
          </button>
          <button class="flex-1 h-9 rounded-xl bg-raised hover:bg-hairline border border-hairline-strong text-ink grid place-items-center transition-all" onclick={() => (startMin = (startMin + 15) % 1440)} aria-label="Increase start time">
            <Plus size={18} strokeWidth={1.5} />
          </button>
        </div>
      </section>
      <section class="bg-surface border border-hairline p-3.5 rounded-card elevation-card flex flex-col justify-between">
        <div class="flex flex-col gap-1">
          <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Finish cut-off</span>
          <span class="text-[9px] font-extrabold text-kritis bg-kritis/10 px-1.5 py-0.5 rounded border border-kritis/20 truncate w-fit uppercase">Must beat {cutoffClock}</span>
        </div>
        <div class="py-2.5">
          <span class="text-3xl font-extrabold text-ink tracking-tight text-tabular">{fmtClock(cutoffMin)}</span>
          <span class="text-[10px] text-ink-dim block truncate">{Math.floor(cutoffMin / 60)}h {String(cutoffMin % 60).padStart(2, '0')}m hard limit</span>
        </div>
        <div class="flex items-center gap-2 pt-1 border-t border-hairline/60">
          <button class="flex-1 h-9 rounded-xl bg-raised hover:bg-hairline border border-hairline-strong text-ink grid place-items-center transition-all" onclick={() => (cutoffMin = Math.max(120, cutoffMin - 30))} aria-label="Decrease cutoff">
            <Minus size={18} strokeWidth={1.5} />
          </button>
          <button class="flex-1 h-9 rounded-xl bg-raised hover:bg-hairline border border-hairline-strong text-ink grid place-items-center transition-all" onclick={() => (cutoffMin = Math.min(1440, cutoffMin + 30))} aria-label="Increase cutoff">
            <Plus size={18} strokeWidth={1.5} />
          </button>
        </div>
      </section>
    </div>

    <!-- Target IF slider -->
    <section class="bg-surface border border-hairline p-4 rounded-card elevation-card flex flex-col gap-3">
      <div class="flex justify-between items-center">
        <span class="text-[11px] font-bold tracking-wider uppercase text-ink-dim">Target intensity (IF)</span>
        <span class="text-[11px] font-extrabold text-crimson-deep bg-raised border border-signal/40 px-2.5 py-0.5 rounded-pill text-tabular">IF {ifTarget.toFixed(2)}</span>
      </div>
      <input
        class="w-full h-2 bg-tile border border-hairline rounded-pill appearance-none cursor-pointer accent-crimson"
        type="range"
        min="0.55"
        max="0.95"
        step="0.01"
        bind:value={ifTarget}
      />
      <div class="flex justify-between items-center text-xs">
        <span class="font-semibold {ifTone}">{ifDesc}</span>
        <span class="text-ink font-bold text-tabular">{targetWatts || '—'} W target</span>
      </div>
    </section>

    <!-- Bike & cargo -->
    <section class="bg-surface border border-hairline p-4 rounded-card elevation-card flex flex-col gap-3">
      <span class="text-[11px] font-bold tracking-wider uppercase text-ink-dim">Bike &amp; cargo load</span>
      <div class="grid grid-cols-2 gap-2.5">
        {#each bikes as b (b.id)}
          {@const selected = b.id === selectedBikeId}
          <button
            class="p-3 rounded-2xl text-left flex flex-col gap-1 transition-all {selected
              ? 'bg-raised border border-signal/50'
              : 'bg-raised/60 border border-hairline opacity-80 hover:opacity-100'}"
            onclick={() => (selectedBikeId = b.id)}
          >
            <span class="flex items-center justify-between">
              <span class="text-[9px] font-extrabold uppercase tracking-wider {selected ? 'text-crimson-deep' : 'text-ink-dim'}">
                {selected ? 'Selected' : 'Standby'}
              </span>
              {#if selected}
                <Check size={18} strokeWidth={1.5} class="text-signal" />
              {:else}
                <span class="h-4 w-4 rounded-pill border border-ink-dim"></span>
              {/if}
            </span>
            <span class="text-xs font-bold text-ink truncate">{b.name}</span>
            <span class="text-[11px] text-ink-dim text-tabular">{b.type} · {b.weightKg} kg</span>
          </button>
        {/each}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
        <div class="flex items-center justify-between bg-raised p-2.5 rounded-2xl border border-hairline">
          <div class="flex items-center gap-2">
            <Luggage size={18} strokeWidth={1.5} class="text-ink-dim" />
            <span class="text-xs text-ink font-medium">Packed cargo</span>
          </div>
          <div class="flex items-center gap-1.5">
            <button class="w-7 h-7 rounded-lg bg-surface border border-hairline-strong grid place-items-center text-ink text-xs font-bold" onclick={() => (cargoKg = Math.max(0, cargoKg - 0.5))}>−</button>
            <span class="text-xs font-bold text-ink text-tabular min-w-12 text-center">{cargoKg.toFixed(1)} kg</span>
            <button class="w-7 h-7 rounded-lg bg-surface border border-hairline-strong grid place-items-center text-ink text-xs font-bold" onclick={() => (cargoKg = Math.min(25, cargoKg + 0.5))}>+</button>
          </div>
        </div>
        <div class="flex items-center justify-between bg-raised p-2.5 rounded-2xl border border-hairline">
          <div class="flex items-center gap-2">
            <Coffee size={18} strokeWidth={1.5} class="text-ink-dim" />
            <div class="flex flex-col">
              <span class="text-xs text-ink font-medium">Aid stops</span>
              <span class="text-[9px] text-ink-dim">{Math.round(stopsMin / 10)} CP stops planned</span>
            </div>
          </div>
          <div class="flex items-center gap-1.5">
            <button class="w-7 h-7 rounded-lg bg-surface border border-hairline-strong grid place-items-center text-ink text-xs font-bold" onclick={() => (stopsMin = Math.max(0, stopsMin - 5))}>−</button>
            <span class="text-xs font-bold text-ink text-tabular min-w-12 text-center">{stopsMin} min</span>
            <button class="w-7 h-7 rounded-lg bg-surface border border-hairline-strong grid place-items-center text-ink text-xs font-bold" onclick={() => (stopsMin = Math.min(180, stopsMin + 5))}>+</button>
          </div>
        </div>
      </div>
    </section>

    <!-- Intermediate checkpoints -->
    <section class="bg-surface border border-hairline p-4 rounded-card elevation-card flex flex-col gap-3">
      <div class="flex justify-between items-center">
        <span class="text-[11px] font-bold tracking-wider uppercase text-ink-dim">Intermediate checkpoints</span>
        <span class="text-[10px] font-bold text-ink-dim bg-raised px-2 py-0.5 rounded border border-hairline">{checkpoints.length} active</span>
      </div>
      <div class="flex flex-col gap-2">
        {#each checkpoints as cp, i (i)}
          <div class="bg-raised border border-hairline p-3 rounded-2xl flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-aman/15 text-aman border border-aman/30 grid place-items-center shrink-0">
                <Check size={17} strokeWidth={1.5} />
              </div>
              <div class="flex flex-col">
                <div class="flex items-center gap-1.5">
                  <span class="text-xs font-bold text-ink text-tabular">KM {cp.km}</span>
                  {#if cp.label}<span class="text-[10px] font-bold text-aman bg-aman/10 px-1.5 py-0.5 rounded border border-aman/20 uppercase">{cp.label}</span>{/if}
                </div>
                {#if cp.cutoffMin != null}
                  <span class="text-[11px] text-ink-dim mt-0.5 text-tabular">Roll-by before {fmtClock((cp.cutoffMin ?? 0) + startMin)}</span>
                {/if}
              </div>
            </div>
            <button
              class="w-8 h-8 rounded-full bg-surface border border-hairline text-ink-dim hover:text-kritis grid place-items-center transition-colors"
              onclick={() => (checkpoints = checkpoints.filter((_, j) => j !== i))}
              aria-label="Remove checkpoint"
            >
              <Trash2 size={17} strokeWidth={1.5} />
            </button>
          </div>
        {/each}
      </div>
      <button
        class="w-full py-2.5 bg-raised/60 hover:bg-raised border border-dashed border-hairline-strong rounded-2xl text-ink-dim hover:text-crimson-deep hover:border-signal/50 flex items-center justify-center gap-1.5 transition-all"
        onclick={() => (checkpoints = [...checkpoints, { km: 175, cutoffMin: 705, label: 'CP3 Bukittinggi' }])}
      >
        <Plus size={17} strokeWidth={1.5} />
        <span class="text-[11px] font-bold uppercase tracking-wider">Add checkpoint cut-off</span>
      </button>
    </section>

    <!-- YOUR PLAN — the monolith highlight card -->
    <SectionCard kicker="Your plan · optimized" dark>
      <div class="flex items-baseline gap-3">
        <span class="text-[40px] leading-none font-extrabold tracking-tight text-tabular" style="color:#ff4d5e">{planTotal}</span>
        <span class="bg-[#23252c] px-2 py-0.5 rounded-pill text-[10px] font-black text-on-mono-dim text-tabular uppercase">
          {#if bufferMin == null}
            no cut-off data
          {:else}
            {bufferMin >= 0 ? '+' : '−'}{Math.floor(Math.abs(bufferMin) / 60)}h {Math.abs(bufferMin % 60)}m buffer
          {/if}
        </span>
      </div>
      <div class="flex items-center justify-between text-on-mono-dim font-bold text-[11px] pt-1 border-t border-[#2b2d33] text-tabular">
        <span>ETA <span class="text-on-mono">{planEta}</span></span>
        <span class="text-[#3f434b]">·</span>
        <span>AVG <span class="text-on-mono">{planAvgKph == null ? '—' : planAvgKph.toFixed(1)} KM/H</span></span>
        <span class="text-[#3f434b]">·</span>
        <span><span style="color:#ff4d5e">{targetWatts} W</span> NP</span>
      </div>
    </SectionCard>

    <!-- 3 slowest sectors -->
    <SectionCard kicker="3 slowest sectors">
      {#snippet right()}
        <ShieldAlert size={15} strokeWidth={1.5} class="text-kritis" />
      {/snippet}
      <div class="flex flex-col gap-2">
        {#if slowestSectors.length === 0}
          <p class="text-sm text-ink-dim">
            No solved profile yet — import a GPX on the Routes page and the slow stretches come from the same solver as the finish estimate.
          </p>
        {/if}
        {#each slowestSectors as s (s.name)}
          <div class="flex items-center justify-between bg-raised border border-hairline p-2.5 rounded-2xl">
            <div class="flex items-center gap-2.5">
              <div class="w-7 h-7 rounded-lg grid place-items-center shrink-0 {s.tone === 'signal' ? 'bg-signal/15 text-signal border border-signal/30' : s.tone === 'aman' ? 'bg-aman/15 text-aman border border-aman/30' : 'bg-surface text-ink-dim border border-hairline-strong'}">
                <Mountain size={16} strokeWidth={1.5} />
              </div>
              <div class="flex flex-col">
                <span class="text-xs font-bold text-ink">{s.name}</span>
                <span class="text-[10px] text-ink-dim text-tabular">KM {s.km.toFixed(0)} · {s.grade} · {s.kph.toFixed(1)} km/h</span>
              </div>
            </div>
            <div class="flex flex-col items-end">
              <span class="text-xs font-bold text-tabular {s.tone === 'signal' ? 'text-crimson-deep' : s.tone === 'aman' ? 'text-aman' : 'text-ink'}">{s.mins}m</span>
              <span class="text-[10px] text-ink-dim text-tabular">{s.watts} W</span>
            </div>
          </div>
        {/each}
      </div>
    </SectionCard>

    <!-- CTA (solid signal — the plan card holds the gradient moment) -->
    <button
      class="mt-1 w-full h-14 rounded-pill bg-crimson-fill text-white text-sm tracking-wider uppercase font-black flex items-center justify-center gap-2 glow-signal active:scale-[0.98] transition-all"
      onclick={saveAndStart}
    >
      <Timer size={20} strokeWidth={1.5} />
      Start race mode
    </button>
  {:else}
    <!-- ============ LIVE TRACKER (after START — UI-SPEC §4.8 + §18 chrome) ============ -->
    <!-- Buffer hero — monolith with browser chrome (§18): back · address pill (race name) · LIVE -->
    <SectionCard kicker="Buffer vs cut-off" dark>
      {#snippet chrome()}
        <div class="flex items-center justify-between gap-2 bg-black/40 border-b border-white/10 pl-2 pr-3.5 h-9">
          <button
            class="grid h-9 w-9 place-items-center rounded-full text-on-mono/70 hover:text-on-mono transition-colors"
            onclick={backToSetup}
            aria-label="Back to setup"
          >
            <ChevronLeft size={18} strokeWidth={1.6} />
          </button>
          <span
            class="flex-1 min-w-0 flex items-center justify-center gap-1.5 rounded-pill bg-white/10 px-3 py-1 text-[10px] font-bold text-on-mono/80"
            title="{name} — race telemetry window"
          >
            <Lock size={10} strokeWidth={1.6} class="shrink-0 opacity-60" />
            <span class="truncate">{name}</span>
          </span>
          <span class="flex items-center gap-1.5 shrink-0" aria-hidden="true">
            <span class="h-1.5 w-1.5 rounded-pill bg-crimson animate-pulse"></span>
            <span class="text-[9px] font-extrabold tracking-[0.14em] text-on-mono/60">LIVE</span>
          </span>
        </div>
      {/snippet}
      {#snippet right()}
        <StatusChip
          label={status === 'aman' ? 'Ahead of target' : status === 'waspada' ? 'Watch the clock' : status === 'unknown' ? 'No plan' : 'Behind cut-off'}
          status={status === 'unknown' ? 'neutral' : status}
          icon={status === 'kritis' ? 'alert' : status === 'waspada' ? 'warn' : status === 'unknown' ? undefined : 'check'}
          onDark
        />
      {/snippet}
      <p class="text-metric-hero text-tabular font-extrabold glow-crimson" style="color:#ff4d5e">
        {bufferLabel}<span class="text-xl font-bold text-on-mono-dim ml-2">{buffer == null ? 'NO PLAN' : buffer >= 0 ? 'BUFFER' : 'BEHIND'}</span>
      </p>
      <div class="flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-on-mono-dim">
        <span>Now · {clockNow}</span>
        <span>Cut-off · {fmtClock(startMin + cutoffMin)}</span>
      </div>
      <HatchTrack pct={progressPct} status="signal" marker onDark />
      <div class="flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-on-mono-dim text-tabular">
        <span>{kmAtClock.toFixed(1)} km done</span>
        <span>{Math.max(0, raceKm - kmAtClock).toFixed(1)} km to go</span>
      </div>
    </SectionCard>

    <!-- Live profile: same solver as the setup page, crosshair reads buffer vs cut-off (§23) -->
    <section class="bg-surface border border-hairline rounded-card p-4 flex flex-col gap-2.5 elevation-card">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] font-bold tracking-wider uppercase text-ink-dim">Course &amp; cut-offs</span>
        {#if probe}
          <StatusChip
            label={probe.feasibility === 'aman' ? `${probe.bufferMin >= 0 ? '+' : '−'}${Math.round(Math.abs(probe.bufferMin))}m ${probe.gateLabel}` : `${probe.gateLabel} missed`}
            status={probe.feasibility}
            icon={probe.feasibility === 'aman' ? 'check' : probe.feasibility === 'waspada' ? 'warn' : 'alert'}
          />
        {:else if chartRows.length < 2}
          <span class="text-[9px] font-extrabold uppercase tracking-wider text-ink-dim bg-tile border border-hairline rounded-pill px-2 py-0.5">No GPX</span>
        {/if}
      </div>

      {#if chartRows.length >= 2}
        <SpeedProfileChart
          points={chartRows}
          height={168}
          targetWatts={targetWatts}
          markers={chartMarkers}
          positionKm={kmAtClock}
          onhover={(p) => (probeKm = p ? p.km : null)}
        >
          {#snippet tooltip(p)}
            <span class="text-[10px] font-extrabold uppercase tracking-wider text-rose">KM {p.km.toFixed(1)}</span>
            <span class="text-[11px] font-bold text-white tabular">
              {p.gradePct >= 0 ? '+' : ''}{p.gradePct.toFixed(1)}% · {p.altM.toFixed(0)} m · {p.kph.toFixed(1)} km/h
            </span>
            {#if probe}
              <span class="text-[10px] font-bold tabular" style="color:{probe.feasibility === 'aman' ? '#4ade9a' : probe.feasibility === 'waspada' ? '#ffb35a' : '#ff8a92'}">
                {probe.bufferMin >= 0 ? '+' : '−'}{Math.abs(probe.bufferMin).toFixed(0)} min vs {probe.gateLabel}
              </span>
              <span class="text-[10px] font-semibold text-on-mono-dim tabular">
                {clockOf(probe.clockMin)} · {probe.remainingKm.toFixed(1)} km to gate
              </span>
            {:else}
              <span class="text-[10px] font-semibold text-on-mono-dim tabular">{clockOf(p.clockMin)}</span>
            {/if}
            {#if probeSustain}
              <span class="text-[10px] font-bold tabular" style="color:{probeSustain.sustainable ? '#4ade9a' : '#ffb35a'}">
                {probeSustain.requiredW} W needed
                {#if probeSustain.cp !== null}
                  · {probeSustain.availableW} W left at CP/W′
                {:else}
                  · no CP fit
                {/if}
              </span>
              <span class="text-[9px] font-semibold text-on-mono-dim">
                {#if probeSustain.wPrimePct !== null}
                  W′ {Math.round(probeSustain.wPrimePct * 100)}% · {probeSustain.reason}
                {:else}
                  {probeSustain.reason}
                {/if}
              </span>
            {/if}
          {/snippet}
        </SpeedProfileChart>
        <p class="text-[10px] font-medium text-ink-dim">
          Drag the crosshair to check any point against the cut-off it leads to.
          {#if !kmLogged}
            <span class="text-crimson-deep">Position follows your plan until you log a checkpoint.</span>
          {/if}
        </p>
      {:else}
        <p class="text-[11px] font-medium text-ink-dim">
          No route profile loaded — import a GPX on the Routes page, or save that route as a race plan,
          to see the course here.
        </p>
      {/if}
    </section>

    <div class="grid grid-cols-2 gap-3">
      <section class="bg-tile border border-hairline rounded-card p-4">
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Projected finish</span>
        <p class="text-3xl font-bold text-ink text-tabular tracking-tight mt-2">{finishClock}</p>
        <p class="text-[11px] text-ink-dim mt-1">{buffer == null ? 'needs a route profile' : `${buffer >= 0 ? '+' : '−'}${Math.abs(buffer)}m to limit`}</p>
      </section>
      <section class="bg-tile border border-hairline rounded-card p-4">
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Required avg</span>
        <p class="text-3xl font-bold text-ink text-tabular tracking-tight mt-2">{reqPace} <span class="text-sm text-ink-dim">km/h</span></p>
        <p class="text-[11px] text-ink-dim mt-1">current avg {avgSpeed}</p>
      </section>
    </div>

    <!-- LOG CHECKPOINT — the one big two-tap input (F7) -->
    <section class="bg-surface border border-hairline rounded-card p-4 flex flex-col gap-3 elevation-card">
      <span class="text-[11px] font-bold tracking-wider uppercase text-ink-dim">Log checkpoint</span>
      <div class="flex items-center gap-2">
        <div class="flex-1 h-14 rounded-2xl bg-tile border border-hairline-strong px-4 flex items-center gap-2">
          <input
            class="w-full bg-transparent outline-none text-ink text-2xl font-extrabold text-tabular"
            type="number"
            inputmode="decimal"
            min="0"
            step="0.1"
            placeholder="KM"
            bind:value={kmInput}
            aria-label="Current kilometers"
          />
          <span class="text-xs text-ink-dim font-bold uppercase">km</span>
        </div>
        <button
          class="h-14 px-5 rounded-2xl bg-crimson-fill text-white text-xs font-extrabold uppercase tracking-wider flex items-center gap-1.5 glow-signal active:scale-[0.98] transition-transform disabled:opacity-40"
          disabled={!kmInput}
          onclick={logCheckpoint}
        >
          <Plus size={18} strokeWidth={2.4} />
          Log
        </button>
      </div>
    </section>

    <!-- Checkpoint cut-offs -->
    {#if cpBuffers.length > 0}
      <section class="bg-surface border border-hairline rounded-card p-4 flex flex-col gap-2.5 elevation-card">
        <span class="text-[11px] font-bold tracking-wider uppercase text-ink-dim">Checkpoint cut-offs</span>
        {#each cpBuffers as cp (cp.km)}
          <div class="flex items-center justify-between bg-raised border border-hairline p-3 rounded-2xl">
            <div class="flex flex-col">
              <span class="text-xs font-bold text-ink text-tabular">KM {cp.km}{cp.label ? ` · ${cp.label}` : ''}</span>
              <span class="text-[10px] text-ink-dim">must pass by {fmtClock(startMin + (cp.cutoffMin ?? 0))}</span>
            </div>
            {#if cp.buffer == null}
              <StatusChip label="no projection" status="neutral" />
            {:else}
              <StatusChip label="{cp.buffer >= 0 ? '+' : '−'}{Math.abs(cp.buffer)}m" status={cpStatus(cp.buffer)} icon={cp.buffer < 0 ? 'alert' : 'check'} />
            {/if}
          </div>
        {/each}
      </section>
    {/if}

    <!-- Checkpoint timeline -->
    <SectionCard kicker="Checkpoint timeline">
      {#if logs.length === 0}
        <p class="text-sm text-ink-dim">No checkpoints logged yet — tap a KM above when you pass a marker.</p>
      {:else}
        <div class="flex flex-col">
          {#each [...logs].reverse() as lg, i (lg.id)}
            <div class="flex items-start gap-3 py-2">
              <div class="flex flex-col items-center pt-1">
                <span class="w-2.5 h-2.5 rounded-pill bg-crimson"></span>
                {#if i < logs.length - 1}<span class="w-px h-6 bg-hairline-strong"></span>{/if}
              </div>
              <div class="flex flex-col min-w-0">
                <span class="text-sm font-bold text-ink text-tabular">KM {lg.km}</span>
                <span class="text-[11px] text-ink-dim text-tabular">
                  {new Date(lg.at * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {fmtDur((lg.at * 1000 - startTimeMs) / 60000)} elapsed
                </span>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </SectionCard>

    <SectionCard kicker="Status">
      <div class="flex gap-2">
        <StatusChip label="Aman" status={status === 'aman' ? 'aman' : 'neutral'} icon={status === 'aman' ? 'check' : undefined} />
        <StatusChip label="Waspada" status={status === 'waspada' ? 'waspada' : 'neutral'} icon={status === 'waspada' ? 'warn' : undefined} />
        <StatusChip label="Kritis" status={status === 'kritis' ? 'kritis' : 'neutral'} icon={status === 'kritis' ? 'alert' : undefined} />
      </div>
      <p class="mt-3 text-sm text-ink-dim">{statusMsg}</p>
      {#if nowSustain}
        <div class="mt-3 pt-3 border-t border-hairline">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-bold tracking-wider uppercase text-ink-dim">W′ at this pace</span>
            {#if nowSustain.wPrimePct === null}
              <StatusChip label="No CP fit" status="neutral" />
            {:else}
              <StatusChip
                label="{Math.round(nowSustain.wPrimePct * 100)}% · {(nowSustain.wPrimeLeft! / 1000).toFixed(1)} kJ"
                status={nowSustain.sustainable ? 'aman' : 'waspada'}
                icon={nowSustain.sustainable ? 'check' : 'warn'}
              />
            {/if}
          </div>
          <p class="mt-1.5 text-[11px] font-medium text-ink-dim">
            {#if nowSustain.cp === null}
              Ride a power session to fit CP/W′ and this becomes a real judgement instead of a
              pace the model only hopes for.
            {:else}
              {nowSustain.requiredW} W needed here · CP {nowSustain.sustainableW} W ·
              {nowSustain.availableW} W available. {nowSustain.reason}.
            {/if}
          </p>
        </div>
      {/if}
    </SectionCard>

    <button
      class="w-full h-14 rounded-pill bg-surface border border-hairline-strong text-ink text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
      onclick={finishRace}
    >
      <Flag size={18} strokeWidth={1.8} class="text-crimson-deep" />
      Finish &amp; save result
    </button>
    <p class="text-center text-xs text-ink-dim flex items-center justify-center gap-1.5">
      <Activity size={14} strokeWidth={1.5} />
      Works fully offline · screen stays awake in live mode
    </p>
  {/if}
</div>
