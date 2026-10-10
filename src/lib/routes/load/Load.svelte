<script lang="ts">
  import SectionCard from '$lib/components/SectionCard.svelte';
  import LegendPill from '$lib/components/LegendPill.svelte';
  import FitnessChart from '$lib/components/FitnessChart.svelte';
  import PowerCurveChart from '$lib/components/PowerCurveChart.svelte';
  import StatTrio from '$lib/components/StatTrio.svelte';
  import Sparkline from '$lib/components/Sparkline.svelte';
  import EditorialHeader from '$lib/components/EditorialHeader.svelte';
  import {
    allActivities,
    powerCurves,
    computePmc,
    formState,
    hasPmcLoad,
    athlete,
    weightSeries,
    latestFtp,
    ftpSeries,
    powerZones
  } from '$lib/data/queries.svelte';
  import {
    curveValueAt,
    fitCriticalPower,
    mergePowerCurves,
    wPrimeExhaustionTime,
    type CurvePoint
  } from '$lib/domain/power-curve';
  import { fmtDuration, zoneOfPower, DEFAULT_POWER_ZONES } from '$lib/domain/zones';
  import { ftpOnDate } from '$lib/domain/metrics';

  // ---------- timeframe switcher (reference: Last 90 Days / Current Block / All-Time) ----------
  type Window = '28d' | '90d' | 'all';
  // `picked` stays null until the rider chooses; the effective window then falls back to
  // all-time when the 90-day window holds no power rides at all — an empty switcher view
  // on first launch reads as "the app lost my data", not as an honest filter.
  let picked = $state<Window | null>(null);
  const WINDOW_LABEL: Record<Window, string> = {
    '28d': 'Last 4 weeks',
    '90d': 'Last 90 days',
    all: 'All-time'
  };
  const WINDOW_DAYS: Record<Window, number | null> = { '28d': 28, '90d': 90, all: null };

  // ---------- raw data ----------
  const acts = $derived(allActivities.current ?? []);
  const weightKg = $derived(weightSeries.current?.at(-1)?.kg ?? null);
  const ftpVal = $derived(latestFtp.current?.ftp ?? null);
  const ftpHistory = $derived(ftpSeries.current ?? []);
  const hrMax = $derived(athlete.current?.maxHr ?? null);
  const hrRest = $derived(athlete.current?.restingHr ?? null);
  const zones = $derived(powerZones.current ?? DEFAULT_POWER_ZONES);

  // ---------- load / form ----------
  const pmc = $derived(computePmc(acts, 90));
  const lastPmc = $derived(pmc.at(-1));
  const hasLoad = $derived(hasPmcLoad(pmc));
  const ctlVal = $derived(hasLoad ? Math.round(lastPmc!.ctl) : null);
  const atlVal = $derived(hasLoad ? Math.round(lastPmc!.atl) : null);
  const tsbVal = $derived(hasLoad ? Math.round(lastPmc!.tsb) : null);
  const tsbSpark = $derived(pmc.slice(-30).map((p) => p.tsb));
  const taperDelta = $derived(
    hasLoad && tsbSpark.length >= 8 ? Math.round(tsbSpark.at(-1)! - tsbSpark.at(-8)!) : null
  );

  // ---------- mean-max curve, scoped to the selected window ----------
  // power_curves rows are keyed by activityId; the activity date decides which window a
  // curve belongs to, so the switcher filters real rides rather than re-fitting anything.
  const actDateById = $derived(new Map(acts.map((a) => [a.id, a.date])));
  const curvesInWindow = $derived.by(() => {
    return (days: number | null) => {
      const cutoff = days === null ? null : Date.now() - days * 86_400_000;
      return (powerCurves.current ?? []).filter((c) => {
        const iso = actDateById.get(c.activityId);
        if (!iso) return days === null; // orphaned curve: only honest in the all-time view
        const t = new Date(iso).getTime();
        return cutoff === null || t >= cutoff;
      });
    };
  });
  const timeWindow = $derived(picked ?? (curvesInWindow(90).length > 0 ? '90d' : 'all'));
  const windowCurves = $derived(curvesInWindow(WINDOW_DAYS[timeWindow]));
  const mergedCurve = $derived(mergePowerCurves(windowCurves.map((c) => c.points)));
  const curveRides = $derived(windowCurves.length);
  const cpFit = $derived(mergedCurve.length >= 4 ? fitCriticalPower(mergedCurve) : undefined);
  const wPrimeTlim = $derived(cpFit ? wPrimeExhaustionTime(cpFit) : undefined);
  const tlimLabel = $derived(wPrimeTlim === undefined ? '—' : fmtDuration(wPrimeTlim));

  // ---------- FTP monolith: W/kg delta vs the previous 4-week mean ----------
  const ftpThen = $derived.by(() => {
    if (ftpHistory.length < 2) return null;
    const cutoffIso = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
    return ftpOnDate(ftpHistory, cutoffIso);
  });
  const wkgNow = $derived(ftpVal && weightKg ? ftpVal / weightKg : null);
  const wkgDelta = $derived(
    wkgNow !== null && ftpThen !== null && ftpThen > 0 && weightKg
      ? wkgNow - ftpThen / weightKg
      : null
  );

  // ---------- model confidence (CP fit quality as a percentage) ----------
  const modelAccuracy = $derived(cpFit ? Math.round(cpFit.r2 * 100) : null);
  const modelConfidence = $derived.by(() => {
    if (modelAccuracy === null) return null;
    if (modelAccuracy >= 90) return 'High certainty';
    if (modelAccuracy >= 75) return 'Reasonable';
    return 'Thin evidence';
  });

  // ---------- summary telemetry (reference: NP / VI / IF tiles) ----------
  // Scoped to the same effective window as the curve, so the tiles and the chart can
  // never disagree about which rides they are describing.
  const summaryTiles = $derived.by(() => {
    const days = WINDOW_DAYS[timeWindow];
    const cutoff = days === null ? null : Date.now() - days * 86_400_000;
    const scored = acts.filter(
      (a) => (a.np ?? 0) > 0 && (cutoff === null || new Date(a.date).getTime() >= cutoff)
    );
    if (scored.length === 0) return null;
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const np = Math.round(avg(scored.map((a) => a.np!)));
    const viPairs = scored.filter((a) => (a.avgPower ?? 0) > 0).map((a) => a.np! / a.avgPower!);
    const ifPairs = scored.filter((a) => (a.if ?? 0) > 0).map((a) => a.if!);
    return {
      np,
      vi: viPairs.length > 0 ? Math.round(avg(viPairs) * 100) / 100 : null,
      intensity: ifPairs.length > 0 ? Math.round(avg(ifPairs) * 100) / 100 : null,
      rides: scored.length
    };
  });

  // ---------- standard durations table (reference: best-efforts at fixed windows) ----------
  const TABLE_DURATIONS: { sec: number; label: string; highlight?: boolean }[] = [
    { sec: 60, label: '1 min' },
    { sec: 300, label: '5 min' },
    { sec: 600, label: '10 min' },
    { sec: 1200, label: '20 min', highlight: true },
    { sec: 3600, label: '1 hour' }
  ];
  const tableRows = $derived.by(() => {
    if (!ftpVal || mergedCurve.length === 0) return [];
    const longest = mergedCurve.at(-1)!.durationSec;
    const rows: {
      label: string;
      highlight: boolean;
      watts: number;
      pctFtp: number;
      wkg: string;
      zone: string;
    }[] = [];
    for (const d of TABLE_DURATIONS) {
      if (d.sec > longest) continue;
      const watts: number | undefined = curveValueAt(mergedCurve as readonly CurvePoint[], d.sec);
      if (watts === undefined || watts <= 0) continue;
      rows.push({
        label: d.label,
        highlight: Boolean(d.highlight),
        watts,
        pctFtp: Math.round((watts / ftpVal) * 100),
        wkg: weightKg ? (watts / weightKg).toFixed(2) : '—',
        zone: zoneOfPower(watts, ftpVal, zones)?.name ?? '—'
      });
    }
    return rows;
  });

  const signWkg = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
</script>

<div class="mx-auto max-w-md px-5 pt-8 pb-10 flex flex-col gap-5">
  <EditorialHeader
    kicker="Load · Progress engine"
    headline="Fitness & fatigue"
    sub="Chronic load, acute load and the power they produce —"
    accent="am I actually getting faster?"
  />

  <!-- FTP MONOLITH — the headline number, with its confidence shown, not hidden -->
  <section class="relative overflow-hidden rounded-card bg-mono text-on-mono glow-soft bg-mono-gradient p-5">
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5 rounded-pill bg-white/10 px-2.5 py-1">
          <span class="h-1.5 w-1.5 rounded-full bg-crimson"></span>
          <span class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">Estimated model</span>
        </div>
        <span class="text-[11px] font-semibold tracking-wide text-on-mono-dim">
          {curveRides > 0 ? `${curveRides} power ride${curveRides === 1 ? '' : 's'}` : 'No power data'}
        </span>
      </div>

      <div class="flex items-baseline justify-between pt-1">
        <div>
          <span class="mb-0.5 block text-[11px] font-bold uppercase tracking-wider text-on-mono-dim">
            Functional threshold power
          </span>
          <div class="flex items-baseline gap-1.5">
            <span class="text-metric-hero text-tabular font-extrabold tracking-tighter text-on-mono">
              {ftpVal ?? '—'}
            </span>
            <span class="text-metric-md font-bold text-on-mono/60">W</span>
          </div>
        </div>
        {#if wkgDelta !== null}
          <div class="flex flex-col items-end">
            <div class="flex items-center gap-1 rounded-xl bg-white/5 px-2.5 py-1">
              <span class="text-label-lg font-bold text-tabular text-on-mono">{signWkg(wkgDelta)}</span>
              <span class="text-[10px] text-on-mono-dim">W/kg</span>
            </div>
            <span class="mt-1 text-[10px] text-on-mono-dim">vs 28 days ago</span>
          </div>
        {/if}
      </div>

      <!-- confidence transparency bar -->
      {#if modelAccuracy !== null && modelConfidence}
        <div class="flex flex-col gap-2 rounded-2xl bg-white/5 p-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5">
              <span class="text-[11px] font-bold uppercase tracking-wider text-on-mono">Model accuracy: {modelAccuracy}%</span>
            </div>
            <span class="text-[11px] text-on-mono-dim">{modelConfidence}</span>
          </div>
          <div class="flex h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              class="h-full rounded-full bg-crimson-gradient"
              style="width:{Math.max(4, Math.min(100, modelAccuracy))}%"
            ></div>
          </div>
          <p class="pt-0.5 text-[11px] leading-relaxed text-on-mono-dim">
            CP/W' fit from {cpFit!.points} measured durations across {curveRides} ride{curveRides === 1 ? '' : 's'} —
            no extrapolation past the longest effort.
          </p>
        </div>
      {:else}
        <div class="rounded-2xl bg-white/5 p-3">
          <p class="text-[11px] leading-relaxed text-on-mono-dim">
            {#if mergedCurve.length === 0}
              Ride with a power meter (FIT or Strava) — the curve and the CP/W' model build from those traces.
            {:else}
              Not enough long efforts yet to fit a trustworthy CP/W' model — keep riding with power.
            {/if}
          </p>
        </div>
      {/if}
    </div>
  </section>

  <!-- SPECIFIC POWER + HR BIOMETRICS (reference grid; both from stored data only) -->
  <div class="grid grid-cols-2 gap-3">
    <div class="flex flex-col justify-between rounded-2xl bg-mono p-4 text-on-mono glow-soft bg-mono-gradient">
      <div class="flex items-center justify-between">
        <span class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">Specific power</span>
        <span class="h-1.5 w-1.5 rounded-full bg-crimson"></span>
      </div>
      <div class="my-2">
        <div class="flex items-baseline gap-1">
          <span class="text-headline-lg-mobile font-extrabold text-tabular text-on-mono">
            {wkgNow !== null ? wkgNow.toFixed(2) : '—'}
          </span>
          <span class="text-[11px] font-bold text-on-mono/60">W/kg</span>
        </div>
        <span class="mt-0.5 block text-[10px] text-on-mono-dim">
          {weightKg !== null ? `At current ${weightKg.toFixed(1)} kg` : 'Log a weight to unlock'}
        </span>
      </div>
      <div class="rounded-lg bg-white/5 p-2 pt-2 text-center">
        <span class="text-[11px] font-bold text-on-mono/80">
          {ftpVal !== null ? `${Math.round((ftpVal / 250) * 100) / 100}× 250 W reference` : '—'}
        </span>
      </div>
    </div>

    <div class="flex flex-col justify-between rounded-2xl bg-mono p-4 text-on-mono glow-soft bg-mono-gradient">
      <div class="flex items-center justify-between">
        <span class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">HR biometrics</span>
        <span class="h-1.5 w-1.5 rounded-full bg-crimson"></span>
      </div>
      <div class="my-1 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-semibold text-on-mono/70">Max HR</span>
          <span class="text-label-lg font-bold text-tabular text-on-mono">
            {hrMax ?? '—'}<span class="ml-1 text-[10px] text-on-mono/50">bpm</span>
          </span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-semibold text-on-mono/70">Resting HR</span>
          <span class="text-label-lg font-bold text-tabular text-on-mono">
            {hrRest ?? '—'}<span class="ml-1 text-[10px] text-on-mono/50">bpm</span>
          </span>
        </div>
      </div>
      <div class="rounded-lg bg-white/5 p-2 pt-2 text-center">
        <span class="text-[11px] font-bold text-on-mono/80">
          {hrMax !== null && hrRest !== null ? `Reserve: ${hrMax - hrRest} bpm` : 'Set in Settings → Profile'}
        </span>
      </div>
    </div>
  </div>

  <!-- FITNESS & FATIGUE -->
  <SectionCard kicker="Fitness & fatigue">
    {#snippet right()}
      <LegendPill
        items={[
          { label: `CTL ${ctlVal ?? '—'}`, dot: 'signal' },
          { label: `ATL ${atlVal ?? '—'}`, dot: 'outline' }
        ]}
      />
    {/snippet}
    <FitnessChart series={pmc} />
    <div class="mt-3 flex items-center justify-between border-t border-hairline pt-3 text-[11px]">
      <span class="font-medium text-ink-dim">30-day form progression</span>
      {#if taperDelta !== null}
        <span class="font-bold text-tabular text-ink">{taperDelta >= 0 ? '+' : ''}{taperDelta} pts</span>
      {/if}
    </div>
    <div class="mt-2">
      <Sparkline points={tsbSpark} width={360} height={40} showBaseline ariaLabel="Form TSB last 30 days" />
    </div>
    <div class="mt-4 grid grid-cols-3 border-t border-hairline pt-4 text-center">
      <div>
        <p class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Form band</p>
        <p class="mt-0.5 text-[15px] font-extrabold text-ink">
          {tsbVal === null ? '—' : formState(tsbVal)}
        </p>
      </div>
      <div class="border-x border-hairline">
        <p class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Fitness</p>
        <p class="mt-0.5 text-[15px] font-extrabold text-tabular text-ink">{ctlVal ?? '—'} CTL</p>
      </div>
      <div>
        <p class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Fatigue</p>
        <p class="mt-0.5 text-[15px] font-extrabold text-tabular text-ink">{atlVal ?? '—'} ATL</p>
      </div>
    </div>
  </SectionCard>

  <!-- MEAN-MAXIMAL POWER CURVE -->
  <SectionCard kicker="Power curve">
    {#snippet right()}
      <LegendPill
        items={[
          { label: WINDOW_LABEL[timeWindow], dot: 'signal' },
          { label: cpFit ? `R² ${cpFit.r2.toFixed(3)}` : "CP/W' model", dot: 'outline' }
        ]}
      />
    {/snippet}

    <!-- timeframe switcher -->
    <div class="mb-4 flex items-center gap-1 rounded-pill bg-tile p-1">
      {#each Object.entries(WINDOW_LABEL) as [key, label] (key)}
        <button
          type="button"
          class="flex-1 rounded-pill px-2 py-2 text-[11px] font-bold transition-all {timeWindow === key
            ? 'bg-surface text-ink elevation-card'
            : 'text-ink-dim hover:text-ink'}"
          onclick={() => (picked = key as Window)}
        >
          {label}
        </button>
      {/each}
    </div>

    {#if mergedCurve.length >= 2}
      <PowerCurveChart curve={mergedCurve} fit={cpFit} />
      <div class="mt-4 border-t border-hairline pt-3">
        <StatTrio
          items={[
            { label: 'Critical power', value: cpFit ? `${cpFit.cp}` : '—' },
            { label: "W'", value: cpFit ? `${(cpFit.wPrime / 1000).toFixed(1)} kJ` : '—' },
            { label: 'Time to empty', value: tlimLabel }
          ]}
        />
      </div>
      <p class="mt-2 text-[11px] font-medium text-ink-dim">
        {#if cpFit}
          Fitted across {cpFit.points} durations from {curveRides} power ride{curveRides === 1 ? '' : 's'}
          · W' empties at CP; below it, power is borrowed, not earned.
        {:else}
          {curveRides} power ride{curveRides === 1 ? '' : 's'} in this window — ride longer efforts to fit the
          critical power model.
        {/if}
      </p>
    {:else}
      <div class="grid place-items-center py-10 text-center">
        <span class="kicker">No power in this window</span>
        <p class="mt-1.5 max-w-[32ch] text-[11px] font-medium text-ink-dim">
          Ride with a power meter (FIT or Strava) — the mean-max curve and the CP/W' model build from those traces.
        </p>
      </div>
    {/if}
  </SectionCard>

  <!-- STANDARD DURATIONS — best efforts at the durations that matter (reference table) -->
  {#if tableRows.length > 0 && ftpVal}
    <section class="flex flex-col gap-2.5">
      <div class="flex items-center justify-between px-1">
        <span class="kicker">Standard durations</span>
        <span class="text-[11px] font-bold uppercase tracking-wider text-crimson-deep">
          {WINDOW_LABEL[timeWindow]} records
        </span>
      </div>
      <div class="flex flex-col overflow-hidden rounded-card border border-hairline bg-surface elevation-card">
        <!-- header -->
        <div class="grid grid-cols-12 bg-tile px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
          <div class="col-span-3">Duration</div>
          <div class="col-span-3 text-right">Power</div>
          <div class="col-span-3 text-right">W/kg</div>
          <div class="col-span-3 text-right">Zone</div>
        </div>
        {#each tableRows as row, i (row.label)}
          <div class="grid grid-cols-12 items-center px-4 py-3 {i % 2 === 1 ? 'bg-tile/40' : ''}">
            <div class="col-span-3">
              <span class="text-[13px] font-bold text-ink {row.highlight ? 'font-extrabold' : ''}">{row.label}</span>
            </div>
            <div class="col-span-3 text-right">
              <div class="text-[13px] font-extrabold text-tabular {row.highlight ? 'text-crimson-deep' : 'text-ink'}">
                {row.watts} W
              </div>
              <span class="block text-[10px] text-ink-dim">{row.pctFtp}% FTP</span>
            </div>
            <div class="col-span-3 text-right">
              <span class="text-[13px] font-bold text-tabular {row.highlight ? 'text-crimson-deep' : 'text-ink'}">
                {row.wkg}
              </span>
            </div>
            <div class="col-span-3 flex justify-end">
              <span class="rounded-pill bg-tile px-2 py-0.5 text-[10px] font-bold text-ink-dim">{row.zone}</span>
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- SUMMARY TELEMETRY — NP / VI / IF averaged over scored rides -->
  {#if summaryTiles}
    <div class="grid grid-cols-3 gap-2.5">
      <div class="flex flex-col justify-between rounded-2xl border border-hairline bg-surface p-3 elevation-card">
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Norm power</span>
        <div class="my-1.5">
          <span class="text-metric-md font-extrabold text-tabular text-ink">{summaryTiles.np}</span>
          <span class="text-[10px] font-bold text-ink-dim">W</span>
        </div>
        <span class="text-[10px] leading-tight text-ink-dim">{WINDOW_LABEL[timeWindow]} avg, scored rides</span>
      </div>
      <div class="flex flex-col justify-between rounded-2xl border border-hairline bg-surface p-3 elevation-card">
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Variability</span>
        <div class="my-1.5">
          <span class="text-metric-md font-extrabold text-tabular text-ink">
            {summaryTiles.vi !== null ? summaryTiles.vi.toFixed(2) : '—'}
          </span>
        </div>
        <span class="text-[10px] leading-tight text-ink-dim">NP ÷ avg power (VI)</span>
      </div>
      <div class="flex flex-col justify-between rounded-2xl border border-hairline bg-surface p-3 elevation-card">
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Intensity</span>
        <div class="my-1.5">
          <span class="text-metric-md font-extrabold text-tabular text-ink">
            {summaryTiles.intensity !== null ? summaryTiles.intensity.toFixed(2) : '—'}
          </span>
        </div>
        <span class="text-[10px] leading-tight text-ink-dim">Avg IF · {summaryTiles.rides} rides</span>
      </div>
    </div>
  {/if}

  <p class="text-center text-xs text-ink-dim">
    CTL = 42-day load average · ATL = 7-day · TSB = CTL − ATL (ARCHITECTURE §5.2).
  </p>
</div>
