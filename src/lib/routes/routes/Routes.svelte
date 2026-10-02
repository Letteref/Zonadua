<script lang="ts">
  import EditorialHeader from '$lib/components/EditorialHeader.svelte';
  import CircleButton from '$lib/components/CircleButton.svelte';
  import SpeedProfileChart from '$lib/components/SpeedProfileChart.svelte';
  import { ChartLine, Flag, Bike as BikeIcon, Backpack, Coffee, Sun, Lock, CheckCircle2, LoaderCircle, FileUp } from '@lucide/svelte';
  import { activeBike, appSettings, latestFtp, weightSeries } from '$lib/data/queries.svelte';
  import { route } from '$lib/router.svelte';
  import { db, type Race } from '$lib/data/db';
  import { newId } from '$lib/data/seed';
  import { haversineM, parseCourse } from '$lib/domain/course';
  import type { ProfilePoint } from '$lib/domain/physics';
  import { buildPlan, clockOf, durationOf, planSeries } from '$lib/domain/pacing';
  import { formatDistance, formatElevation, formatWeight, type UnitSystem } from '$lib/domain/units';

  // ---------- route state (real GPX replaces the M0 preview) ----------
  let routeName = $state('Bukit Barisan 200');
  let loadedRouteId = $state<string | null>(null);
  /** real elevation profile in km/alt — the physics input, never chart-normalised */
  let rawProfile = $state<ProfilePoint[] | null>(null);
  let fileInput: HTMLInputElement | null = $state(null);
  let parsing = $state(false);
  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function showToast(msg: string, sticky = false): void {
    toast = msg;
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(() => (toast = null), 3400);
  }

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
  let selectedIdx = $state(1);

  // editable setup — every one of these moves the physics
  let cargoKg = $state(3);
  let stopCount = $state(2);
  let stopMin = $state(15);
  let headwindKph = $state(0);
  let startMin = $state(START_MIN);

  const npTarget = $derived(Math.round(modes[selectedIdx].if * ftp));
  const barPct = $derived(Math.max(2, Math.min(100, ((modes[selectedIdx].if - 0.55) / 0.4) * 100)));

  /** Named control points; the ETA of each one is solved, never assumed. */
  const CHECKPOINTS = [
    { km: 25, label: 'Rolling Flats' },
    { km: 87, label: 'Mid Valley' },
    { km: 120, label: 'Koto Tinggi Climb', cutoffMin: 10 * 60 + 30 },
    { km: 160, label: 'Summit Ridge' },
    { km: 200.4, label: 'Finish Line', cutoffMin: 13 * 60 }
  ];

  const plan = $derived(
    buildPlan({
      profile,
      physics: {
        riderKg,
        bikeKg: bike?.weightKg ?? 9.4,
        cargoKg,
        crr: bike?.crr ?? 0.0045,
        cda: bike?.cda ?? 0.32,
        temperatureC: 20,
        headwindKph
      },
      pacing: { mode: 'if', ifTarget: modes[selectedIdx].if, ftp },
      stops: { count: stopCount, minutesEach: stopMin },
      startMin,
      checkpoints: CHECKPOINTS
    })
  );

  const routeElevM = $derived(Math.round(plan.climbM ?? 0));
  /** one chart row per solved point — altitude + solved speed + elapsed, never normalised */
  const chartRows = $derived(planSeries(plan));
  const movingSec = $derived(plan.movingSec ?? 0);
  const kcal = $derived(Math.round((plan.energyKJ ?? 0) / 4.184));
  const avgKph = $derived(plan.avgKph ?? 0);
  const estFinish = $derived(plan.ok ? durationOf(plan.elapsedSec!) : '—');
  const etaFinish = $derived(plan.ok ? clockOf(plan.finishClockMin!) : '—');

  const setupTiles = $derived([
    { icon: BikeIcon, label: 'Bike:', value: bike?.name ?? '—', tone: 'aman' },
    { icon: Backpack, label: 'Cargo:', value: formatWeight(cargoKg, unit), tone: 'aman' },
    { icon: Coffee, label: 'Stops:', value: `${stopCount} × ${stopMin} min`, tone: 'signal' },
    { icon: Sun, label: 'Start:', value: clockOf(startMin), tone: 'signal' }
  ] as const);

  // Checkpoint rows come straight from the plan, so the table can never drift from the estimate
  const waypoints = $derived(
    plan.checkpoints.map((c, i) => ({
      ...c,
      isFinish: i === plan.checkpoints.length - 1,
      isCp: c.bufferMin !== undefined,
      grade: `${c.gradePct >= 0 ? '+' : ''}${c.gradePct.toFixed(1)}% grade`,
      kmLabel: `${c.km.toFixed(1)}k`,
      eta: clockOf(c.clockMin),
      elapsed: durationOf(c.elapsedSec)
    }))
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
    parsing = true;
    showToast('Parsing route…', true);
    try {
      // the tested domain parser owns distance, gain and the point list
      const ride = parseCourse(await file.text(), file.name);
      if (ride.distanceKm < 0.1) throw new Error('Route too short');

      // build the km/alt profile the physics actually consumes
      const xy: Array<[number, number]> = [];
      let distM = 0;
      let prevLat = NaN;
      let prevLng = NaN;
      let prevAlt = NaN;
      for (const p of ride.points) {
        if (p.lat != null && p.lng != null) {
          if (Number.isFinite(prevLat)) distM += haversineM(prevLat, prevLng, p.lat, p.lng);
          prevLat = p.lat;
          prevLng = p.lng;
        }
        if (p.alt != null) prevAlt = p.alt;
        xy.push([distM / 1000, prevAlt]);
      }

      const stride = Math.ceil(xy.length / 600); // bound the stored point count
      const sampled = xy.filter((_, i) => i % stride === 0 || i === xy.length - 1);

      if (typeof CompressionStream === 'undefined') throw new Error('Compression unsupported');
      const stream = new Blob([JSON.stringify(xy)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      const compressed = new Uint8Array(await new Response(stream).arrayBuffer());

      const id = newId();
      await db.routes.put({
        id,
        name: ride.name,
        distanceKm: ride.distanceKm,
        elevGainM: ride.elevGainM,
        pointsCompressed: compressed,
        pointCount: xy.length,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      loadedRouteId = id;
      routeName = ride.name;
      rawProfile = sampled.map(([km, alt]) => ({ distKm: km, altM: alt }));
      showToast(
        `Loaded ${routeName} — ${formatDistance(ride.distanceKm, unit)} · ${formatElevation(ride.elevGainM, unit)} of climbing`
      );
    } catch (err) {
      console.error('[gowslab] route import failed:', err);
      showToast('Import failed — use a GPX file with trackpoints');
    } finally {
      parsing = false;
    }
  }

  // ---------- export GPX (from the stored profile) ----------
  function exportGpx(): void {
    if (!loadedRouteId) {
      showToast('Export available after importing a GPX');
      return;
    }
    void (async () => {
      const rows = await db.routes.get(loadedRouteId!);
      if (!rows) return;
      const blobStream = new Blob([rows.pointsCompressed as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const xy: Array<[number, number]> = JSON.parse(await new Response(blobStream).text());
      const body = xy.map(([km, alt]) => `  <trkpt lat="0" lon="0"><ele>${alt.toFixed(1)}</ele></trkpt><!-- ${km.toFixed(2)} km -->`).join('\n');
      const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GowsLab"><trk><name>${routeName}</name><trkseg>\n${body}\n</trkseg></trk></gpx>`;
      const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${routeName}.gpx`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('GPX exported');
    })();
  }

  // ---------- save as race plan → Dexie → Race page ----------
  async function saveAsRacePlan(): Promise<void> {
    try {
      const routeRows = await db.routes.toArray();
      const routeId = loadedRouteId ?? routeRows[0]?.id ?? 'stub-route';
      const existing = await db.races.where('status').anyOf(['planned', 'live']).toArray();
      const base: Race = existing[0]
        ? { ...existing[0], name: routeName, status: 'planned', updatedAt: Date.now() }
        : {
            id: newId(),
            routeId,
            name: routeName,
            startTime: new Date(new Date().setHours(0, 0, 0, 0) + startMin * 60000).toISOString(),
            cutoffFinishMin: 13 * 60,
            checkpoints: [{ km: 120, cutoffMin: 570, label: 'CP2 Payakumbuh' }],
            // carry the solved plan, not just the inputs — M4 projects from this
            planJson: JSON.stringify({
              ifTarget: modes[selectedIdx].if,
              cargoKg,
              stopCount,
              stopMin,
              headwindKph,
              bikeId: bike?.id,
              targetWatts: plan.targetWatts,
              movingSec,
              elapsedSec: plan.elapsedSec,
              avgKph,
              climbM: plan.climbM
            }),
            status: 'planned',
            updatedAt: Date.now()
          };
      await db.races.put(base);
      showToast('Race plan saved — opening Race…');
      setTimeout(() => route.navigate('race'), 800);
    } catch (err) {
      console.error('[gowslab] saveAsRacePlan failed:', err);
      showToast('Could not save the plan');
    }
  }
</script>

<div class="mx-auto max-w-md px-5 pt-8 pb-10 flex flex-col gap-5">
  <EditorialHeader
    kicker={hasRoute ? 'Route specification' : 'Route estimator'}
    headline={routeName}
    sub={hasRoute ? 'Loaded from GPX —' : 'No route loaded yet —'}
    accent={hasRoute ? `${formatDistance(routeKm, unit)} · ${formatElevation(routeElevM, unit)} of climbing.` : 'sample route below.'}
  >
    <CircleButton icon="share-2" label="Export GPX" onclick={exportGpx} />
  </EditorialHeader>

  <input bind:this={fileInput} class="hidden" type="file" accept=".gpx" onchange={onGpxPick} aria-label="Import GPX route" />

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
        <FileUp size={24} strokeWidth={1.5} />
      </div>
      <div class="flex flex-col gap-1">
        <h2 class="text-base font-extrabold tracking-tight text-ink">Import your event GPX</h2>
        <p class="text-[13px] text-ink-dim leading-relaxed max-w-[32ch]">
          The estimator reads the route profile and projects your finish from FTP {ftp} W, your active bike and stop pattern — fully offline.
        </p>
      </div>
      <button
        class="h-11 px-5 rounded-pill bg-crimson-fill text-white text-[11px] font-extrabold uppercase tracking-wider flex items-center gap-2 glow-signal active:scale-[0.98] transition-transform"
        onclick={(e) => {
          e.stopPropagation();
          fileInput?.click();
        }}
      >
        <FileUp size={16} strokeWidth={2} />
        Choose GPX file
      </button>
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
      <div class="flex items-center justify-center gap-1 py-1.5 px-1 rounded-xl bg-[#1b1c22] border border-[#2b2d33]">
        <span class="text-[9px] font-bold uppercase text-on-mono-dim">{plan.powerLimitedCount ? `${plan.powerLimitedCount} WALL` : 'CAT HC'}</span>
      </div>
    </div>
  </section>

  <!-- Elevation + solved speed, crosshair tooltip (UI-SPEC §21) -->
  <section class="rounded-card bg-surface border border-hairline p-4 flex flex-col relative overflow-hidden elevation-card">
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-1.5">
        <ChartLine size={18} strokeWidth={1.5} class="text-signal" />
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
      <div class="grid grid-cols-3 gap-1 p-1 rounded-pill bg-canvas border border-hairline">
        {#each modes as m, i (m.name)}
          <button
            class="py-2 px-1 text-center rounded-pill transition-colors {selectedIdx === i
              ? 'bg-raised text-ink border border-signal/50 uppercase tracking-wider font-extrabold'
              : 'text-ink-dim hover:text-ink uppercase tracking-wider font-bold border border-transparent'} text-[10px] font-extrabold"
            onclick={() => (selectedIdx = i)}
          >
            {m.name}
            <span class="block text-[9px] {selectedIdx === i ? 'text-crimson-deep' : 'text-ink-dim'} font-normal normal-case">IF {m.if.toFixed(2)}</span>
          </button>
        {/each}
      </div>
      <div class="flex flex-col gap-1.5 pt-1">
        <div class="flex items-center justify-between">
          <span class="text-[13px] text-ink font-semibold">Normalized Power Target</span>
          <span class="text-[30px] leading-none text-crimson text-tabular font-extrabold">{npTarget} <span class="text-base font-normal text-ink-dim">W</span></span>
        </div>
        <div class="relative w-full h-3 bg-canvas rounded-pill overflow-hidden flex items-center border border-hairline">
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
          {@const Icon = t.icon}
          <div class="p-2.5 rounded-2xl bg-raised border border-hairline flex flex-col gap-1">
            <div class="flex items-center gap-1.5 {t.tone === 'aman' ? 'text-aman' : 'text-signal'}">
              <Icon size={16} strokeWidth={1.5} />
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
            Headwind <span class="text-ink text-tabular">{headwindKph} km/h</span>
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

  <!-- Checkpoints -->
  <section>
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-1.5">
        <Flag size={18} strokeWidth={1.5} class="text-signal" />
        <span class="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-dim">Checkpoints &amp; control points</span>
      </div>
      <span class="text-[10px] font-extrabold uppercase text-ink-dim px-2 py-0.5 rounded bg-surface border border-hairline">solved from physics</span>
    </div>
    <div class="grid grid-cols-1 gap-2">
      {#each waypoints as w (w.label)}
        <div class="rounded-2xl bg-surface border {w.isCp ? 'border-signal/40' : 'border-hairline'} p-3 flex items-center justify-between hover:border-hairline-strong transition-colors">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-12 h-10 rounded-xl {w.isCp ? 'bg-signal/15 border border-signal/40' : 'bg-raised border border-hairline'} flex flex-col items-center justify-center shrink-0">
              <span class="text-[11px] font-bold text-ink text-tabular leading-none">{w.kmLabel}</span>
              <span class="text-[8px] text-ink-dim uppercase tracking-wider">KM</span>
            </div>
            <div class="flex flex-col min-w-0">
              <span class="truncate font-semibold text-ink text-sm flex items-center gap-1.5">
                {w.label}
                {#if w.isCp}<Lock size={12} strokeWidth={1.5} class="text-signal shrink-0" />{/if}
              </span>
              <span class="text-[10px] font-extrabold uppercase tracking-wider {w.isCp ? 'text-crimson-deep' : 'text-ink-dim'}">
                {w.grade} · {w.legKph.toFixed(1)} km/h leg
              </span>
            </div>
          </div>
          <div class="flex flex-col items-end shrink-0 text-tabular">
            <span class="text-xs font-bold {w.isCp ? 'text-crimson-deep' : 'text-ink'}">{w.eta}</span>
            <span class="text-[10px] text-ink-dim">{w.elapsed}</span>
            {#if w.bufferMin !== undefined}
              <span class="text-[10px] font-bold {w.bufferMin < 0 ? 'text-kritis' : 'text-aman'}">
                {w.bufferMin >= 0 ? '+' : ''}{w.bufferMin.toFixed(0)} min vs cut-off
              </span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </section>

  <button
    class="w-full h-14 rounded-pill bg-crimson-fill text-white text-sm tracking-wider uppercase font-black flex items-center justify-center gap-2 glow-signal active:scale-[0.98] transition-all"
    onclick={saveAsRacePlan}
  >
    <Flag size={20} strokeWidth={1.5} />
    Save as race plan
  </button>
</div>

{#if toast || parsing}
  <div class="fixed inset-x-0 bottom-[calc(88px+env(safe-area-inset-bottom,0px)+8px)] z-[55] mx-auto max-w-md px-5">
    <div class="flex items-center justify-center gap-2 rounded-pill bg-mono text-on-mono px-4 py-2.5 elevation-raised">
      {#if parsing}
        <LoaderCircle size={15} strokeWidth={2} class="animate-spin text-rose" />
        <span class="text-[11px] font-bold uppercase tracking-wider">Parsing route…</span>
      {:else}
        <CheckCircle2 size={15} strokeWidth={2} class="text-aman" />
        <span class="text-[11px] font-bold uppercase tracking-wider">{toast}</span>
      {/if}
    </div>
  </div>
{/if}
