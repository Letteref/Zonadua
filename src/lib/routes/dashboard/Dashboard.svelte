<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import SectionCard from '$lib/components/SectionCard.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import Sparkline from '$lib/components/Sparkline.svelte';
  import {
    allActivities,
    appSettings,
    allRoutes,
    nextRace,
    powerZones,
    weightSeries,
    latestFtp,
    ftpSeries,
    computeWeek,
    computePmc,
    computeWear,
    formState,
    hasPmcLoad,
    allBikesWithComponents
  } from '$lib/data/queries.svelte';
  import { db, isCyclingActivity } from '$lib/data/db';
  import { decodeStream, extractPower } from '$lib/data/streams';
  import { zoneDistribution, type ZoneDistribution, type ZoneBand } from '$lib/domain/zones';
  import { computePmc as computePmcDomain, weeklyTssTarget } from '$lib/domain/pmc';
  import { distanceUnit, formatDistance, formatElevation, formatPowerPerWeight, formatWeight, splitValue, type UnitSystem } from '$lib/domain/units';
  import { buildCoachInsight, polishPrompt } from '$lib/domain/coach-insight';
  import { buildHeatmap, heatLevel } from '$lib/domain/heatmap';
  import { buildCtlChart } from '$lib/domain/ctl-chart';
  import { generate } from '$lib/infra/ai/provider';
  import { verifyNumbers } from '$lib/infra/ai/verify';

  // ---------- hero tabs (browser chrome kept) ----------
  type HeroTab = 'today' | 'form' | 'load';
  const HERO_TABS: { id: HeroTab; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'form', label: 'Form' },
    { id: 'load', label: 'Load' }
  ];
  let heroTab = $state<HeroTab>('today');

  const unit = $derived<UnitSystem>(appSettings.current?.unit ?? 'metric');
  const distLabel = $derived(distanceUnit(unit));
  const fmtDist = $derived((km: number, digits = 1) => formatDistance(km, unit, digits));

  const acts = $derived(allActivities.current ?? []);
  const cycling = $derived(acts.filter(isCyclingActivity));
  const week = $derived(computeWeek(acts));

  // ---------- PMC ----------
  const pmc = $derived(computePmc(acts, 90));
  const lastPmc = $derived(pmc.at(-1));
  const hasLoad = $derived(hasPmcLoad(pmc));
  const ctlVal = $derived(hasLoad ? Math.round(lastPmc!.ctl) : null);
  const atlVal = $derived(hasLoad ? Math.round(lastPmc!.atl) : null);
  const tsbVal = $derived(hasLoad ? Math.round(lastPmc!.tsb) : null);
  const tsbSpark = $derived(pmc.slice(-30).map((p) => p.tsb));
  const tsbDelta = $derived(
    hasLoad && tsbSpark.length >= 8 ? Math.round(tsbSpark.at(-1)! - tsbSpark.at(-8)!) : null
  );

  // ---------- CTL trend for the hero chart (12 weeks, like the reference) ----------
  const pmc12w = $derived(computePmcDomain(acts, 84));
  const ctlChart = $derived(buildCtlChart(pmc12w));

  // ---------- FTP / weight ----------
  const ftpVal = $derived(latestFtp.current?.ftp);
  const weight = $derived(weightSeries.current?.at(-1)?.kg ?? null);
  const wkg = $derived(ftpVal && weight ? splitValue(formatPowerPerWeight(ftpVal, weight, unit)) : null);
  const ftpTestedDays = $derived.by(() => {
    const rows = ftpSeries.current ?? [];
    if (rows.length === 0 || !ftpVal) return null;
    const last = rows.at(-1)!;
    return Math.max(0, Math.round((Date.now() - new Date(last.date).getTime()) / 86_400_000));
  });

  // ---------- weekly TSS target (domain derivation — shared with the Rides week card) ----------
  const tssTarget = $derived(weeklyTssTarget(cycling));

  // ---------- weekly target ----------
  const weekPct = $derived(tssTarget > 0 ? Math.min(100, Math.round((week.tss / tssTarget) * 100)) : 0);

  // ---------- lifetime totals (summary chips) ----------
  const lifetime = $derived.by(() => {
    return {
      rides: cycling.length,
      km: Math.round(cycling.reduce((s, a) => s + (a.distanceKm || 0), 0)),
      vert: Math.round(cycling.reduce((s, a) => s + (a.elevGainM || 0), 0))
    };
  });

  // ---------- 30-day zone distribution (streams decoded best-effort) ----------
  let zoneDist = $state<ZoneDistribution | null>(null);
  $effect(() => {
    const activities = cycling;
    const ftp = ftpVal;
    const bands = powerZones.current;
    if (!activities || !ftp || !bands) return;
    let cancelled = false;
    void (async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const counts = new Map<string, number>();
      let totalSamples = 0;
      let sum = 0;
      for (const a of activities) {
        if (new Date(a.date) < cutoff) continue;
        const row = await db.activity_streams.get(a.id);
        const samples = await decodeStream(row);
        const trace = extractPower(samples);
        if (!trace) continue;
        const d = zoneDistribution(trace.watts, ftp, trace.sampleSec, bands);
        for (const z of d.zones) {
          counts.set(z.band.key, (counts.get(z.band.key) ?? 0) + z.sec);
        }
        totalSamples += trace.watts.length * trace.sampleSec;
        sum += d.avgPower * trace.watts.length * trace.sampleSec;
      }
      if (cancelled) return;
      if (totalSamples === 0) {
        zoneDist = null;
        return;
      }
      const zones = bands.map((band: ZoneBand) => {
        const sec = counts.get(band.key) ?? 0;
        return {
          band,
          minWatts: Math.round((band.minPct / 100) * ftp),
          sec,
          pct: Math.round((sec / totalSamples) * 1000) / 10
        };
      });
      zoneDist = { zones, totalSec: totalSamples, avgPower: Math.round(sum / totalSamples) };
    })();
    return () => {
      cancelled = true;
    };
  });

  // ---------- 16-week heatmap + weekly TSS bars (pure domain: $lib/domain/heatmap) ----------
  const heatmap = $derived(buildHeatmap(cycling));

  /** The domain returns a 0–4 level; the component owns only the color ramp. */
  function heatClass(tss: number): string {
    switch (heatLevel(tss, heatmap.maxDay)) {
      case 1:
        return 'bg-[#ffad2e]/30';
      case 2:
        return 'bg-[#ffad2e]/60';
      case 3:
        return 'bg-[#e0113c]/70';
      case 4:
        return 'bg-[#e0113c]';
      default:
        return 'bg-white/5';
    }
  }

  // ---------- coach insight (deterministic) + optional AI polish ----------
  const raceCard = $derived.by(() => {
    const r = nextRace.current;
    if (!r) return null;
    const routeRow = (allRoutes.current ?? []).find((x) => x.id === r.routeId);
    const km = routeRow?.distanceKm ?? null;
    const days = Math.ceil((new Date(r.startTime).getTime() - Date.now()) / 86_400_000);
    const cutoffH = Math.floor(r.cutoffFinishMin / 60);
    const cutoffM = r.cutoffFinishMin % 60;
    return {
      name: r.name,
      days,
      live: r.status === 'live',
      km,
      elevM: routeRow?.elevGainM ?? null,
      cutoffH,
      cutoffM,
      subtitle:
        r.status === 'live'
          ? 'Race mode is live — open the tracker'
          : days > 0
            ? `${new Date(r.startTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · in ${days} day${days === 1 ? '' : 's'}${cutoffH > 0 ? ` · cut-off ${cutoffH}h ${String(cutoffM).padStart(2, '0')}m` : ''}`
            : 'Race day has arrived'
    };
  });

  const wearWorst = $derived.by(() => {
    const all = (allBikesWithComponents.current ?? []).flatMap(({ bike, components }) =>
      components.map((c) => ({ ...computeWear(c, bike.odometerKm), bikeName: bike.name }))
    );
    return all.sort((x, y) => y.pct - x.pct)[0] ?? null;
  });

  const hiShare30d = $derived(zoneDist && zoneDist.totalSec > 0
    ? Math.round(zoneDist.zones.filter((z) => z.band.minPct >= 90).reduce((s, z) => s + z.pct, 0) * 10) / 10
    : null);

  const insightInput = $derived({
    ctl: ctlVal,
    atl: atlVal,
    tsb: tsbVal,
    tsbDelta7d: tsbDelta,
    weekTss: week.tss,
    weekKm: week.km,
    // actual ride count this week (two rides in one day are two rides), not ride-days —
    // the headline says "across N rides", so N must be rides. Window matches computeWeek:
    // the 7 calendar days ending today.
    weekRides: (() => {
      const cutoff = new Date();
      cutoff.setHours(0, 0, 0, 0);
      cutoff.setDate(cutoff.getDate() - 6);
      return cycling.filter((a) => new Date(a.date) >= cutoff).length;
    })(),
    tssTarget,
    ftp: ftpVal ?? null,
    ftpAgeDays: ftpTestedDays,
    hiShare30d,
    race: raceCard && raceCard.days <= 28 ? { name: raceCard.name, days: Math.max(0, raceCard.days) } : null,
    wear: wearWorst && wearWorst.pct >= 0.85 ? { name: wearWorst.comp.name, pct: wearWorst.pct } : null
  });
  const insight = $derived(buildCoachInsight(insightInput));

  let polished = $state<string | null>(null);
  let polishing = $state(false);
  $effect(() => {
    // reset the polished text whenever the underlying insight changes
    void insight.headline;
    polished = null;
    polishing = false;
  });

  async function onPolish(): Promise<void> {
    if (polishing) return;
    polishing = true;
    try {
      const req = polishPrompt(insight);
      const res = await generate(req.prompt, req.system);
      // the reply may only restate the figures it was shown — the same gate the review uses
      const v = verifyNumbers(res.text, `${req.prompt}\n${insight.headline}\n${insight.advice}\n${insight.evidence}`);
      polished = v.ok ? res.text.trim() : insight.headline;
    } catch {
      polished = null;
    } finally {
      polishing = false;
    }
  }

  const aiReady = $derived(Boolean(appSettings.current?.aiKey));

  // ---------- all-demo chip ----------
  const allDemo = $derived.by(() => {
    return acts.length > 0 && acts.every((a) => a.synthetic === true);
  });

  // form band label (hero)
  const FORM_LABELS: Record<ReturnType<typeof formState>, string> = {
    fresh: 'Recover first',
    detraining: 'Detraining',
    balanced: 'Balanced',
    productive: 'Building',
    peaking: 'Peaked'
  };
  const formLabel = $derived(tsbVal === null ? 'No data' : FORM_LABELS[formState(tsbVal)]);

  // zone colours for the distribution card (light surfaces)
  const ZONE_BG: Record<string, string> = {
    Z0: '#d9dce0',
    Z1: '#a8adb5',
    Z2: '#6f757e',
    Z3: '#ff8a92',
    Z4: '#e8102e',
    Z5: '#a80c21',
    Z6: '#7a0a19',
    Z7: '#141519'
  };
  const fmtHours = (sec: number): string => {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    if (h === 0) return `${m}m`;
    return `${h}.${Math.round((m / 60) * 10)}h`;
  };
</script>

<div class="mx-auto max-w-md px-5 pt-8 pb-10 flex flex-col gap-5">
  <!-- Editorial masthead -->
  <div class="flex flex-col gap-0.5">
    <div class="flex items-center gap-1.5">
      <span class="text-[11px] font-bold uppercase tracking-wider text-ink-dim">Today</span>
      <span class="h-1.5 w-1.5 rounded-pill bg-crimson"></span>
    </div>
    <h1 class="text-[26px] leading-[32px] tracking-tight font-extrabold text-ink">Welcome back</h1>
    <p class="mt-1 text-[15px] leading-[22px] text-ink-dim">
      {#if hasLoad && tsbVal !== null}
        Form is {formLabel.toLowerCase()} ({tsbVal > 0 ? '+' : ''}{tsbVal} TSB). {insight.advice.split('.')[0]}.
      {:else}
        Ride with power (FIT or Strava) to unlock your form and load figures.
      {/if}
    </p>
  </div>

  {#if allActivities.ready}
    <!-- ============ MONOLITH HERO ============ -->
    <section class="relative overflow-hidden rounded-3xl bg-mono text-on-mono glow-mono bg-mono-gradient p-5 flex flex-col gap-5">
      <div class="absolute -right-16 -top-16 h-60 w-60 rounded-pill bg-crimson/20 blur-3xl pointer-events-none"></div>
      <div class="absolute -left-12 -bottom-10 h-44 w-44 rounded-pill bg-crimson/10 blur-2xl pointer-events-none"></div>

      <!-- browser chrome: traffic lights + tabs (kept from the previous design) -->
      <div class="relative z-10 flex items-center justify-between gap-2 border-b border-white/10 pb-2.5">
        <div class="flex items-center gap-1.5" aria-hidden="true">
          <span class="h-2.5 w-2.5 rounded-pill bg-crimson"></span>
          <span class="h-2.5 w-2.5 rounded-pill bg-[#eab308]/85"></span>
          <span class="h-2.5 w-2.5 rounded-pill bg-[#22c55e]/85"></span>
        </div>
        <div class="flex items-center gap-0.5" role="tablist" aria-label="Hero telemetry views">
          {#each HERO_TABS as t (t.id)}
            <button
              type="button"
              role="tab"
              id="hero-tab-{t.id}"
              aria-selected={heroTab === t.id}
              onclick={() => (heroTab = t.id)}
              class="rounded-pill px-2.5 py-1 text-[10.5px] font-bold tracking-[0.04em] transition-colors {heroTab === t.id
                ? 'bg-white/12 text-on-mono'
                : 'text-on-mono/55 hover:text-on-mono'}"
            >
              {#if heroTab === t.id}<span class="mr-1 inline-block h-[5px] w-[5px] rounded-pill bg-crimson align-middle"></span>{/if}
              {t.label}
            </button>
          {/each}
        </div>
        <div class="flex items-center gap-1.5" class:opacity-30={!raceCard?.live} aria-hidden={raceCard?.live ? undefined : 'true'}>
          <span class="h-1.5 w-1.5 rounded-pill bg-crimson" class:animate-pulse={raceCard?.live}></span>
          <span class="text-[10px] font-extrabold tracking-[0.14em] text-on-mono/50">LIVE</span>
        </div>
      </div>

      <!-- hero-pane: stable test hook inside the monolith (never unrendered) -->
      <span id="hero-pane" class="hidden"></span>

      <!-- ============ TODAY PANE ============ -->
      {#if heroTab === 'today'}
        <div class="relative z-10 flex items-start justify-between">
          <div class="flex flex-col">
            <div class="mb-1 flex items-center gap-1.5">
              <span class="h-1.5 w-1.5 animate-pulse rounded-pill bg-[#ffad2e]"></span>
              <span class="text-[11px] font-bold uppercase tracking-[0.12em] text-on-mono/50">Fitness (CTL)</span>
            </div>
            <div class="flex items-baseline gap-3">
              <span class="text-[58px] font-extrabold leading-none tracking-tighter text-white text-tabular">{ctlVal ?? '—'}</span>
              {#if ctlChart && Math.abs(ctlChart.ctlDelta) >= 1}
                <span class="inline-flex items-center gap-1 rounded-pill border border-white/10 bg-white/10 px-2.5 py-1 backdrop-blur-md">
                  <span class="text-[11px] font-bold text-white/90 text-tabular">{ctlChart.ctlDelta > 0 ? '+' : ''}{ctlChart.ctlDelta} over 8w</span>
                </span>
              {/if}
            </div>
          </div>
          <div class="flex flex-col items-end">
            <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-on-mono/40">Target phase</span>
            <span class="mt-1.5 inline-flex items-center gap-1.5 rounded-pill border border-white/10 bg-white/5 px-3 py-1 backdrop-blur-sm">
              <span class="h-1.5 w-1.5 rounded-pill bg-[#ffad2e]"></span>
              <span class="text-[12px] font-bold tracking-tight text-[#ff8a92]">{formLabel}</span>
            </span>
          </div>
        </div>

        <!-- CTL/ATL chart -->
        {#if ctlChart}
          <div class="relative z-10 flex flex-col gap-2 pt-1">
            <div class="flex items-center justify-between pb-1 text-[11px] font-bold text-on-mono/50">
              <div class="flex items-center gap-3.5">
                <span class="inline-flex items-center gap-1.5 font-medium text-on-mono/90">
                  <span class="h-0.5 w-2.5 rounded-pill bg-crimson-gradient"></span> CTL (Fitness)
                </span>
                <span class="inline-flex items-center gap-1.5 text-on-mono/40">
                  <span class="h-0.5 w-2.5 rounded-pill bg-[#6f757e]"></span> ATL (Fatigue)
                </span>
              </div>
              <span class="text-[10px] font-semibold uppercase tracking-wider text-on-mono/40">12 wks</span>
            </div>
            <div class="h-24">
              <svg class="h-full w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 {ctlChart.W} {ctlChart.H}">
                <defs>
                  <linearGradient id="ctlLineGrad" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0%" stop-color="#ff0055" />
                    <stop offset="60%" stop-color="#ff1744" />
                    <stop offset="100%" stop-color="#ff5722" />
                  </linearGradient>
                  <linearGradient id="ctlAreaGrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stop-color="#ff0055" stop-opacity="0.35" />
                    <stop offset="65%" stop-color="#ff1744" stop-opacity="0.08" />
                    <stop offset="100%" stop-color="#ff5722" stop-opacity="0" />
                  </linearGradient>
                </defs>
                <line stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,4" x1="0" x2={ctlChart.W} y1="15" y2="15" />
                <line stroke="rgba(255,255,255,0.05)" stroke-dasharray="3,4" x1="0" x2={ctlChart.W} y1="45" y2="45" />
                <line stroke="rgba(255,255,255,0.04)" stroke-dasharray="3,4" x1="0" x2={ctlChart.W} y1="70" y2="70" />
                <path d={ctlChart.atlPath} fill="none" stroke="#636266" stroke-dasharray="4,3" stroke-linecap="round" stroke-width="1.75" />
                <path d={ctlChart.area} fill="url(#ctlAreaGrad)" />
                <path d={ctlChart.ctlPath} fill="none" stroke="url(#ctlLineGrad)" stroke-linecap="round" stroke-linejoin="round" stroke-width="3.25" />
                <circle cx={ctlChart.W} cy={ctlChart.endY} fill="#ff3b30" r="5" stroke="#0d0e11" stroke-width="2.5" />
              </svg>
            </div>
            <div class="flex justify-between px-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-on-mono/40">
              <span class="text-on-mono/30">W1</span>
              <span class="text-on-mono/40">W4</span>
              <span class="text-on-mono/40">W8</span>
              <span class="font-bold text-[#ffad2e]">W12</span>
            </div>
          </div>
        {:else}
          <p class="relative z-10 py-6 text-center text-[13px] text-on-mono/40">
            No load yet — CTL and ATL start from your rides.
          </p>
        {/if}

        <!-- four tiles -->
        <div class="relative z-10 grid grid-cols-2 gap-2 border-t border-white/10 pt-3">
          <div class="flex flex-col justify-between rounded-xl border border-white/10 bg-white/5 p-3">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-bold uppercase tracking-wider text-on-mono/50">Fatigue (ATL)</span>
              <Icon name="zap" size={14} strokeWidth={1.8} class="text-[#ffad2e]" />
            </div>
            <div class="mt-2">
              <span class="text-[20px] font-extrabold leading-none text-white text-tabular">{atlVal ?? '—'}</span>
              <p class="mt-1 text-[10px] font-medium text-on-mono/40">7-day load</p>
            </div>
          </div>
          <div class="flex flex-col justify-between rounded-xl border border-white/10 bg-white/5 p-3">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-bold uppercase tracking-wider text-on-mono/50">Form (TSB)</span>
              <span class="h-1.5 w-1.5 rounded-pill bg-[#ffad2e]"></span>
            </div>
            <div class="mt-2">
              <span class="text-[20px] font-extrabold leading-none text-white text-tabular">{tsbVal === null ? '—' : (tsbVal > 0 ? '+' : '') + tsbVal}</span>
              <p class="mt-1 text-[10px] font-medium text-[#ffad2e]">{formLabel}</p>
            </div>
          </div>
          <div class="flex flex-col justify-between rounded-xl border border-white/10 bg-white/5 p-3">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-bold uppercase tracking-wider text-on-mono/50">FTP</span>
              <Icon name="gauge" size={14} strokeWidth={1.8} class="text-on-mono/40" />
            </div>
            <div class="mt-2">
              <span class="text-[20px] font-extrabold leading-none text-white text-tabular">{ftpVal ? `${ftpVal} W` : '—'}</span>
              <p class="mt-1 text-[10px] font-medium text-on-mono/40">{ftpTestedDays != null ? `Logged ${ftpTestedDays}d ago` : 'Not tested yet'}</p>
            </div>
          </div>
          <div class="flex flex-col justify-between rounded-xl border border-white/10 bg-white/5 p-3">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-bold uppercase tracking-wider text-on-mono/50">W / kg</span>
              <Icon name="user" size={14} strokeWidth={1.8} class="text-on-mono/40" />
            </div>
            <div class="mt-2">
              <span class="text-[20px] font-extrabold leading-none text-white text-tabular">{wkg?.value ?? '—'}</span>
              <p class="mt-1 text-[10px] font-medium text-on-mono/40">{weight ? `At ${formatWeight(weight, unit)}` : 'Add weight in Settings'}</p>
            </div>
          </div>
        </div>

        <!-- today's prescription -->
        <div class="relative z-10 flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5">
              <span class="h-2 w-2 animate-pulse rounded-pill bg-[#ffad2e]"></span>
              <span class="text-[11px] font-bold uppercase tracking-wider text-on-mono/50">Today's prescription</span>
            </div>
            <span class="text-[11px] font-bold uppercase tracking-wider text-[#ffad2e]">{formLabel}</span>
          </div>
          <a
            href="#/rides"
            class="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-pill border border-white/20 bg-crimson-gradient text-[13px] font-extrabold uppercase tracking-wider text-white shadow-[0_8px_24px_-4px_rgba(224,17,60,0.5)] transition-transform active:scale-[0.98]"
          >
            <span class="grid h-6 w-6 place-items-center rounded-pill bg-white/20">
              <Icon name="activity" size={16} strokeWidth={2} />
            </span>
            <span>Log today's ride · {week.km > 0 ? `${fmtDist(week.km, 0)} this week` : 'start the week'}</span>
          </a>
        </div>
      {:else if heroTab === 'form'}
        <!-- ============ FORM PANE (kept) ============ -->
        <div class="relative z-10 flex h-full flex-col gap-1">
          <div class="flex items-baseline justify-between">
            <span class="text-[10.5px] font-bold uppercase tracking-wider text-on-mono-dim">Form · last 30 days</span>
            {#if tsbDelta !== null}
              <span class="text-[12px] font-bold text-tabular text-rose">{tsbDelta >= 0 ? '+' : ''}{tsbDelta} pts / 7d</span>
            {/if}
          </div>
          <div class="-mx-1 min-h-0 flex-1 py-4">
            <Sparkline points={tsbSpark} width={352} height={100} fill showBaseline onDark ariaLabel="Form TSB last 30 days" />
          </div>
          <div class="grid shrink-0 grid-cols-3 border-t border-white/10 pt-4 text-center">
            <div>
              <p class="text-[10.5px] font-bold uppercase tracking-wider text-on-mono-dim">Fitness</p>
              <p class="mt-0.5 text-[18px] font-extrabold text-on-mono text-tabular">CTL {ctlVal ?? '—'}</p>
            </div>
            <div class="border-x border-white/10">
              <p class="text-[10.5px] font-bold uppercase tracking-wider text-on-mono-dim">Fatigue</p>
              <p class="mt-0.5 text-[18px] font-extrabold text-on-mono text-tabular">ATL {atlVal ?? '—'}</p>
            </div>
            <div>
              <p class="text-[10.5px] font-bold uppercase tracking-wider text-on-mono-dim">Form</p>
              <p class="mt-0.5 text-[18px] font-extrabold text-rose text-tabular">
                {tsbVal === null ? '—' : (tsbVal > 0 ? '+' : '') + tsbVal} TSB
              </p>
            </div>
          </div>
        </div>
      {:else}
        <!-- ============ LOAD PANE (kept) ============ -->
        <div class="relative z-10 flex h-full flex-col gap-1">
          <div class="flex items-baseline justify-between">
            <span class="text-[10.5px] font-bold uppercase tracking-wider text-on-mono-dim">Daily load · last 7 days</span>
            <span
              class="text-[12px] font-bold text-tabular text-on-mono"
              title={week.tssEstimated ? 'Includes rides scored from speed & elevation — no power data' : undefined}
            >
              {week.tssEstimated ? `~${week.tss}` : week.tss} TSS / wk
            </span>
          </div>
          <div class="flex h-[132px] items-end gap-2 pt-5">
            {#each week.dailyTss as d (d.date)}
              <div class="flex h-full flex-1 flex-col items-center justify-end gap-2">
                <div
                  class="w-full rounded-t-md border border-[#2b2d33] bg-[#23252c] transition-all hover:border-[#3a3d45]"
                  style="height:{Math.max(3, (d.tss / Math.max(tssTarget * 0.6, ...week.dailyTss.map((x) => x.tss), 1)) * 100)}%"
                  title="{d.date}: {Math.round(d.tss)} TSS"
                ></div>
              </div>
            {/each}
          </div>
          <div class="flex justify-between gap-2 pt-2 text-[9px] font-bold uppercase tracking-wider text-on-mono-dim">
            {#each week.dailyTss as d (d.date)}
              <span>{new Date(`${d.date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'narrow' })}</span>
            {/each}
          </div>
        </div>
      {/if}
    </section>

    {#if allDemo}
      <div class="flex items-center gap-2 px-1">
        <StatusChip label="Demo data" status="neutral" />
        <p class="text-[11px] leading-snug text-ink-dim">
          Every figure here is computed from the bundled sample rides, not your training.
        </p>
      </div>
    {/if}

    <!-- ============ WEEKLY TARGET ============ -->
    <SectionCard kicker="Weekly target">
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-bold uppercase tracking-wider text-ink-dim">Stress vs target</span>
          <span class="text-[13px] font-extrabold text-ink text-tabular">{weekPct}%</span>
        </div>
        <div class="flex items-baseline gap-1.5">
          <span class="text-[22px] font-extrabold tracking-tight text-ink text-tabular">
            {week.tssEstimated ? `~${week.tss}` : week.tss}
          </span>
          <span class="text-[15px] text-ink-dim">/ {tssTarget} TSS target</span>
        </div>
        <div class="h-3 w-full overflow-hidden rounded-pill bg-tile p-0.5">
          <div class="h-full rounded-pill bg-crimson-gradient" style="width:{weekPct}%"></div>
        </div>
        <div class="flex items-center justify-between pt-1 text-[11px] font-bold text-ink-dim">
          <span class="flex items-center gap-1">
            <Icon name="flag" size={15} strokeWidth={1.8} class="text-crimson-deep" />
            {#if week.tss < tssTarget}
              {Math.max(0, Math.round(tssTarget - week.tss))} TSS to hit target
            {:else}
              Target reached — nice work
            {/if}
          </span>
          <span class="font-semibold text-ink">{week.dailyTss.filter((d) => d.tss > 0).length} ride day{week.dailyTss.filter((d) => d.tss > 0).length === 1 ? '' : 's'} this week</span>
        </div>
      </div>
    </SectionCard>

    <!-- ============ SUMMARY CHIPS ============ -->
    <section class="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div class="flex shrink-0 items-center gap-1.5 rounded-pill bg-tile px-4 py-2 text-[13px] font-bold text-ink border border-hairline">
        <Icon name="bike" size={16} strokeWidth={1.8} class="text-crimson-deep" />
        <span>{lifetime.rides} Total rides</span>
      </div>
      <div class="flex shrink-0 items-center gap-1.5 rounded-pill bg-tile px-4 py-2 text-[13px] font-bold text-ink border border-hairline">
        <Icon name="route" size={16} strokeWidth={1.8} class="text-crimson-deep" />
        <span>{lifetime.km.toLocaleString('en-US')} Total {distLabel}</span>
      </div>
      <div class="flex shrink-0 items-center gap-1.5 rounded-pill bg-tile px-4 py-2 text-[13px] font-bold text-ink border border-hairline">
        <Icon name="mountain" size={16} strokeWidth={1.8} class="text-crimson-deep" />
        <span>{formatElevation(lifetime.vert, unit)}</span>
      </div>
    </section>

    <!-- ============ COACH GUIDANCE ============ -->
    <section class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <Icon name="sparkles" size={20} strokeWidth={1.8} class="text-crimson-deep" />
          <h2 class="text-[22px] font-bold tracking-tight text-ink">Coach guidance</h2>
        </div>
        {#if aiReady}
          <span class="text-[11px] font-bold text-ink-dim uppercase tracking-wider">AI polished</span>
        {:else}
          <span class="text-[11px] font-bold text-ink-dim uppercase tracking-wider">From your data</span>
        {/if}
      </div>
      <article class="flex flex-col gap-2 rounded-2xl border border-hairline bg-surface p-5 elevation-card">
        <div class="flex items-center justify-between">
          <span
            class="rounded-pill px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider {insight.severity === 'critical'
              ? 'bg-crimson-fill text-white'
              : insight.severity === 'watch'
                ? 'bg-crimson/10 text-crimson-deep'
                : 'bg-tile text-aman'}"
          >
            {insight.severity === 'critical' ? 'Critical' : insight.severity === 'watch' ? 'Watch' : 'Good'}
          </span>
          <span class="text-[11px] font-bold text-ink-dim">{insight.tag}</span>
        </div>
        <h3 class="mt-1 text-[17px] font-bold leading-[24px] tracking-tight text-ink">{insight.headline}</h3>
        <p class="text-[15px] leading-[22px] text-ink-dim">
          {#if polishing}
            <span class="animate-pulse">Polishing the wording…</span>
          {:else if polished}
            {polished}
          {:else}
            {insight.advice}
          {/if}
        </p>
        <div class="mt-1 rounded-xl bg-tile p-3 text-[11px] font-bold text-ink">
          <span class="uppercase text-ink-dim">Evidence:</span> {insight.evidence}
        </div>
        {#if aiReady}
          <button
            class="mt-1 inline-flex items-center gap-1 self-start text-[13px] font-bold text-crimson-deep active:opacity-75"
            onclick={onPolish}
            disabled={polishing}
          >
            {#if polished}
              Polished — regenerate
            {:else}
              Rewrite with AI <Icon name="sparkles" size={16} strokeWidth={1.8} />
            {/if}
          </button>
        {:else}
          <a href="#/settings" class="mt-1 inline-flex items-center gap-1 self-start text-[13px] font-bold text-ink-dim active:opacity-75">
            Add an AI key to polish the wording <Icon name="arrow-up-right" size={14} strokeWidth={1.8} />
          </a>
        {/if}
      </article>
    </section>

    <!-- ============ ZONE DISTRIBUTION (30 DAYS) ============ -->
    <SectionCard kicker="Power distribution">
      {#snippet right()}
        <span class="text-[11px] font-bold text-ink-dim">30 days</span>
      {/snippet}
      {#if zoneDist && zoneDist.totalSec > 0}
        <div class="flex flex-col gap-3">
          <div class="flex h-3 w-full overflow-hidden rounded-pill bg-tile">
            {#each zoneDist.zones.filter((z) => z.sec > 0) as z (z.band.key)}
              <span class="h-full" style="width:{z.pct}%; background:{ZONE_BG[z.band.key] ?? '#6f757e'}"></span>
            {/each}
          </div>
          <div class="flex flex-col divide-y divide-hairline">
            {#each zoneDist.zones as z (z.band.key)}
              {#if z.sec > 0}
                <div class="flex items-center justify-between py-2 text-[13px] font-bold">
                  <span class="flex items-center gap-2 text-ink">
                    <span class="h-2 w-2 rounded-pill" style="background:{ZONE_BG[z.band.key] ?? '#6f757e'}"></span>
                    {z.band.key} {z.band.name}
                  </span>
                  <span class="text-tabular text-ink">{z.pct}% <span class="font-normal text-ink-dim">({fmtHours(z.sec)})</span></span>
                </div>
              {/if}
            {/each}
          </div>
          <p class="text-[11px] font-medium text-ink-dim">
            Sampled across every power ride in the last 30 days — avg {zoneDist.avgPower} W.
          </p>
        </div>
      {:else}
        <p class="py-4 text-center text-[13px] text-ink-dim">
          No power streams in the last 30 days — import a FIT/GPX with watts or sync a power ride from Strava.
        </p>
      {/if}
    </SectionCard>

    <!-- ============ 16-WEEK HEATMAP (dark monolith) ============ -->
    <section class="relative overflow-hidden rounded-3xl bg-mono text-on-mono glow-mono bg-mono-gradient p-5 flex flex-col gap-4">
      <div class="absolute -right-16 -top-16 h-60 w-60 rounded-pill bg-crimson/20 blur-3xl pointer-events-none"></div>
      <div class="absolute -left-12 -bottom-10 h-44 w-44 rounded-pill bg-crimson/10 blur-2xl pointer-events-none"></div>
      <div class="relative z-10 flex items-start justify-between">
        <div class="flex flex-col">
          <div class="mb-1 flex items-center gap-1.5">
            <span class="h-1.5 w-1.5 animate-pulse rounded-pill bg-[#ffad2e]"></span>
            <span class="text-[11px] font-bold uppercase tracking-[0.12em] text-on-mono/50">Training consistency</span>
          </div>
          <h3 class="text-[22px] font-extrabold tracking-tight text-white">16-Week Heatmap &amp; TSS</h3>
        </div>
        <div class="flex flex-col items-end">
          <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-on-mono/40">Rolling average</span>
          <span class="mt-1.5 inline-flex items-center gap-1.5 rounded-pill border border-white/10 bg-white/5 px-3 py-1 backdrop-blur-sm">
            <span class="h-1.5 w-1.5 rounded-pill bg-[#ffad2e]"></span>
            <span class="text-[12px] font-bold tracking-tight text-[#ffad2e]">{heatmap.avgTss} avg TSS</span>
          </span>
        </div>
      </div>
      <div class="relative z-10 flex flex-col gap-1">
        <div class="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-on-mono/40">
          <span class="text-on-mono/30">W-16</span>
          <span class="text-on-mono/40">W-8</span>
          <span class="font-bold text-[#ffad2e]">Current</span>
        </div>
        <div class="grid w-full grid-flow-col grid-rows-7 gap-1" style="height:112px">
          {#each heatmap.cells as c (c.date)}
            <div class="rounded-[2px] {heatClass(c.tss)}" title="{c.date}: {Math.round(c.tss)} TSS"></div>
          {/each}
        </div>
      </div>
      <div class="relative z-10 flex flex-col gap-1.5 border-t border-white/10 pt-3">
        <div class="flex justify-between text-[10px] font-medium uppercase tracking-wider text-on-mono/40">
          <span>Weekly TSS volume</span>
          <span class="font-bold text-[#ffad2e] text-tabular">
            {heatmap.minWeek} — {heatmap.maxWeek} TSS
          </span>
        </div>
        <div class="flex h-14 w-full items-end gap-1 pt-1">
          {#each heatmap.weeks as w (w.label)}
            <div
              class="h-full flex-1 rounded-t-sm {w.tss > 0 ? 'bg-crimson-gradient' : 'bg-white/20'}"
              style="height:{Math.max(4, (w.tss / heatmap.maxWeek) * 100)}%"
              title="{w.label}: {Math.round(w.tss)} TSS"
            ></div>
          {/each}
        </div>
      </div>
    </section>

    <!-- ============ NEXT CHALLENGE (race, dark monolith) ============ -->
    {#if raceCard}
      <section class="relative overflow-hidden rounded-3xl bg-mono text-on-mono glow-mono bg-mono-gradient p-5 flex flex-col gap-4">
        <div class="absolute -right-16 -top-16 h-60 w-60 rounded-pill bg-crimson/20 blur-3xl pointer-events-none"></div>
        <div class="absolute -left-12 -bottom-10 h-44 w-44 rounded-pill bg-crimson/10 blur-2xl pointer-events-none"></div>
        <div class="relative z-10 flex items-start justify-between gap-3">
          <div class="flex flex-col">
            <div class="mb-1 flex items-center gap-1.5">
              <span class="h-1.5 w-1.5 animate-pulse rounded-pill bg-[#ffad2e]"></span>
              <span class="text-[11px] font-bold uppercase tracking-[0.12em] text-on-mono/50">
                Next challenge {raceCard.days > 0 ? `· ${raceCard.days} days` : ''}
              </span>
            </div>
            <h3 class="mt-0.5 text-[26px] font-extrabold leading-[32px] tracking-tight text-white">{raceCard.name}</h3>
            <p class="mt-1 text-[14px] text-on-mono/50">{raceCard.subtitle}</p>
          </div>
          {#if !raceCard.live}
            <span class="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-white/10 bg-white/5 px-3 py-1 backdrop-blur-sm">
              <Icon name="timer" size={14} strokeWidth={1.8} class="text-[#ffad2e]" />
              <span class="text-[11px] font-bold uppercase tracking-tight text-[#ffad2e]">{raceCard.days}d</span>
            </span>
          {/if}
        </div>
        <div class="relative z-10 grid grid-cols-2 gap-2 pt-1">
          <div class="flex flex-col justify-between rounded-xl border border-white/10 bg-white/5 p-3.5">
            <span class="text-[10px] font-bold uppercase tracking-wider text-on-mono/50">Distance &amp; vert</span>
            <div class="mt-2">
              <span class="text-[18px] font-extrabold leading-none text-white text-tabular">
                {raceCard.km ? fmtDist(raceCard.km, 0) : '—'}{raceCard.elevM ? ` · ${formatElevation(raceCard.elevM, unit)}` : ''}
              </span>
              <p class="mt-1 text-[10px] font-medium text-on-mono/40">{raceCard.km ? 'Planned route' : 'Add a route to the race'}</p>
            </div>
          </div>
          <div class="flex flex-col justify-between rounded-xl border border-white/10 bg-white/5 p-3.5">
            <span class="text-[10px] font-bold uppercase tracking-wider text-on-mono/50">Target cut-off</span>
            <div class="mt-2">
              <span class="text-[18px] font-extrabold leading-none text-[#ffad2e] text-tabular">
                {raceCard.cutoffH > 0 ? `${raceCard.cutoffH}h ${String(raceCard.cutoffM).padStart(2, '0')}m` : `${raceCard.cutoffM}m`}
              </span>
              <p class="mt-1 text-[10px] font-medium text-[#ffad2e]">Finish cut-off</p>
            </div>
          </div>
        </div>
        <div class="relative z-10 flex items-center justify-between border-t border-white/10 pt-3">
          <span class="text-[11px] font-medium text-on-mono/50">Open the live tracker &amp; pacing plan</span>
          <a href="#/race" class="flex items-center gap-1.5 text-[13px] font-bold text-white transition-colors hover:text-[#ffad2e]">
            <span>View race plan</span>
            <Icon name="arrow-up-right" size={16} strokeWidth={2} class="font-bold text-[#ffad2e]" />
          </a>
        </div>
      </section>
    {:else}
      <SectionCard kicker="Next challenge">
        <a href="#/routes" class="flex items-center justify-between" aria-label="Plan your first race">
          <div class="flex items-center gap-3">
            <div class="grid h-10 w-10 place-items-center rounded-pill bg-tile border border-hairline text-ink-dim">
              <Icon name="flag" size={19} strokeWidth={1.5} />
            </div>
            <div class="flex flex-col">
              <span class="text-sm font-bold tracking-tight text-ink">No race planned yet</span>
              <span class="text-[10px] font-extrabold uppercase tracking-wider text-crimson-deep">Import a route &amp; set a plan →</span>
            </div>
          </div>
          <span class="grid h-8 w-8 place-items-center rounded-pill bg-mono text-on-mono">
            <Icon name="arrow-up-right" size={16} strokeWidth={1.5} />
          </span>
        </a>
      </SectionCard>
    {/if}
  {:else}
    <div class="rounded-card bg-surface border border-hairline p-8 text-center elevation-card">
      <span class="kicker">Loading telemetry…</span>
    </div>
  {/if}
</div>
