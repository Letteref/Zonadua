<script lang="ts">
  import EditorialHeader from '$lib/components/EditorialHeader.svelte';
  import StatTile from '$lib/components/StatTile.svelte';
  import SectionCard from '$lib/components/SectionCard.svelte';
  import StatTrio from '$lib/components/StatTrio.svelte';
  import TssBars from '$lib/components/TssBars.svelte';
  import FitnessChart from '$lib/components/FitnessChart.svelte';
  import PowerCurveChart from '$lib/components/PowerCurveChart.svelte';
  import LegendPill from '$lib/components/LegendPill.svelte';
  import HatchTrack from '$lib/components/HatchTrack.svelte';
  import Sparkline from '$lib/components/Sparkline.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import {
    allActivities,
    allBikesWithComponents,
    weightSeries,
    ftpSeries,
    latestFtp,
    athlete,
    appSettings,
    allRoutes,
    nextRace,
    powerCurves,
    computeWeek,
    computePmc,
    computeWear,
    latestWeight
  } from '$lib/data/queries.svelte';
  import { fitCriticalPower, mergePowerCurves, wPrimeExhaustionTime } from '$lib/domain/power-curve';
  import { convertDistance, distanceUnit, formatDistance, formatPowerPerWeight, formatWeight, splitValue, type UnitSystem } from '$lib/domain/units';
  import { Wrench, Calendar, ArrowUpRight, Flag } from '@lucide/svelte';

  // H2 hero chrome: window tabs swap the monolith body (§17 UI-SPEC)
  type HeroTab = 'today' | 'form' | 'load';
  const HERO_TABS: { id: HeroTab; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'form', label: 'Form' },
    { id: 'load', label: 'Load' }
  ];
  let heroTab = $state<HeroTab>('today');

  // Display units only — stored data stays metric, so nothing here can corrupt a metric.
  const unit = $derived<UnitSystem>(appSettings.current?.unit ?? 'metric');
  const fmtDist = $derived((km: number, digits = 1) => formatDistance(km, unit, digits));
  const distLabel = $derived(distanceUnit(unit));

  const week = $derived(computeWeek(allActivities.current ?? []));
  const ridesThisWeek = $derived.by(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 6);
    cutoff.setHours(0, 0, 0, 0);
    return (allActivities.current ?? []).filter((a) => new Date(a.date) >= cutoff).length;
  });
  const pmc = $derived(computePmc(allActivities.current ?? [], 90));
  const lastPmc = $derived(pmc.at(-1));
  const tsbSpark = $derived(pmc.slice(-30).map((p) => p.tsb));
  // M2: merged mean-max curve + CP/W' fit — best effort at each duration, then the
  // minimal model P = W'/t + CP fitted across every activity that carries power.
  const mergedCurve = $derived(mergePowerCurves((powerCurves.current ?? []).map((c) => c.points)));
  const cpFit = $derived(mergedCurve.length >= 4 ? fitCriticalPower(mergedCurve) : undefined);
  const wPrimeTlim = $derived(cpFit ? wPrimeExhaustionTime(cpFit) : undefined);
  // round to whole minutes first, otherwise 59.7 min formats as "0h 60m"
  const tlimLabel = $derived.by(() => {
    if (wPrimeTlim === undefined) return '—';
    const mins = Math.round(wPrimeTlim);
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
  });
  const curveRides = $derived((powerCurves.current ?? []).length);
  const weight = $derived(latestWeight(weightSeries.current ?? []));
  // F3-AC3: worst component across ALL bikes, not just the active one
  const worstWear = $derived.by(() => {
    const all = (allBikesWithComponents.current ?? []).flatMap(({ bike, components }) =>
      components.map((c) => ({ ...computeWear(c, bike.odometerKm), bikeName: bike.name }))
    );
    return all.sort((x, y) => y.pct - x.pct)[0];
  });

  const ftpVal = $derived(latestFtp.current?.ftp);
  // FTP delta derived from history — never hardcoded
  const ftpDelta = $derived.by(() => {
    const rows = ftpSeries.current ?? [];
    if (rows.length < 2 || !ftpVal) return null;
    const prev = rows.at(-2)!.ftp;
    const d = ftpVal - prev;
    return { w: Math.abs(d), dir: d >= 0 ? 'up' : 'down', days: Math.max(1, Math.round((Date.now() - new Date(rows.at(-2)!.date).getTime()) / 86_400_000)) };
  });
  const wkg = $derived(
    ftpVal && weight ? splitValue(formatPowerPerWeight(ftpVal, weight.current, unit)) : null
  );
  const tsbVal = $derived(lastPmc ? Math.round(lastPmc.tsb) : null);
  const ctlVal = $derived(lastPmc ? Math.round(lastPmc.ctl) : null);
  const atlVal = $derived(lastPmc ? Math.round(lastPmc.atl) : null);
  // Readiness preview: TSB mapped to 0–100% (formal definition lands with M2 metrics engine)
  const readiness = $derived(tsbVal === null ? null : Math.max(5, Math.min(95, Math.round(55 + tsbVal * 1.4))));
  const readinessLabel = $derived(
    readiness === null
      ? 'NO DATA'
      : readiness >= 70
        ? 'READY TO PUSH'
        : readiness >= 45
          ? 'STEADY STATE'
          : 'RECOVER FIRST'
  );
  const R = 44;
  const CIRC = 2 * Math.PI * R;
  const ringDash = $derived(readiness === null ? 0 : (readiness / 100) * CIRC);
  const taperDelta = $derived(tsbSpark.length >= 8 ? Math.round(tsbSpark.at(-1)! - tsbSpark.at(-8)!) : null);
  // Weekly TSS target = 4-week average load, rounded to 25 TSS (0 → default 450)
  const tssTarget = $derived.by(() => {
    const acts = allActivities.current ?? [];
    if (acts.length === 0) return 450;
    let sum = 0;
    let weeks = 0;
    for (let w = 1; w <= 4; w++) {
      const from = new Date();
      from.setDate(from.getDate() - w * 7);
      const to = new Date();
      to.setDate(to.getDate() - (w - 1) * 7);
      const t = acts
        .filter((a) => {
          const d = new Date(a.date);
          return d >= from && d < to;
        })
        .reduce((acc, a) => acc + (a.tss ?? 0), 0);
      if (t > 0) {
        sum += t;
        weeks++;
      }
    }
    if (weeks === 0) return 450;
    return Math.max(50, Math.round(sum / weeks / 25) * 25);
  });

  // REAL race card: soonest planned/live race from Dexie (matches the bell reminder)
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
      subtitle:
        r.status === 'live'
          ? 'Race mode is live — open the tracker'
          : days > 0
            ? `Race day in ${days} day${days === 1 ? '' : 's'}${cutoffH > 0 ? ` · cut-off ${cutoffH}h ${String(cutoffM).padStart(2, '0')}m` : ''}`
            : 'Race day has arrived',
      km
    };
  });
  // Progress = elapsed time since start toward race day (plan horizon: 6 weeks out)
  const raceProgress = $derived.by(() => {
    const r = nextRace.current;
    if (!r) return 0;
    if (r.status === 'live') return 1;
    const start = new Date(r.startTime).getTime();
    const horizon = 42 * 86_400_000; // typical 6-week block
    const done = 1 - (start - Date.now()) / horizon;
    return Math.max(0.02, Math.min(1, done));
  });

</script>

<div class="mx-auto max-w-md px-5 pt-8 pb-10 flex flex-col gap-5">
  <div class="flex flex-col gap-1">
    <EditorialHeader
      greeting="Today"
      name={athlete.current?.name ?? 'Athlete'}
      sub="Ready to build your goals today?"
    />
  </div>

  {#if allActivities.ready}
    <!-- MONOLITH HERO: browser-chrome tabs (H2, §17) — Today ring+trio / Form sparkline / Load bars -->
    <SectionCard dark>
      {#snippet chrome()}
        <div class="flex items-center justify-between gap-2 bg-black/40 border-b border-white/10 px-3.5 h-9">
          <div class="flex items-center gap-1.5" aria-hidden="true">
            <span class="h-2.5 w-2.5 rounded-pill bg-crimson"></span>
            <span class="h-2.5 w-2.5 rounded-pill bg-[#eab308]/85"></span>
            <span class="h-2.5 w-2.5 rounded-pill bg-[#22c55e]/85"></span>
          </div>
          <div class="flex-1 flex justify-center" role="tablist" aria-label="Hero telemetry views">
            <div class="flex items-center gap-0.5">
              {#each HERO_TABS as t (t.id)}
                <button
                  type="button"
                  role="tab"
                  id="hero-tab-{t.id}"
                  aria-selected={heroTab === t.id}
                  aria-controls="hero-pane"
                  onclick={() => (heroTab = t.id)}
                  class="flex items-center gap-1 rounded-pill px-2.5 py-1 text-[9.5px] font-bold tracking-[0.04em] transition-colors {heroTab === t.id
                    ? 'bg-white/12 text-on-mono'
                    : 'text-on-mono/55 hover:text-on-mono'}"
                >
                  {#if heroTab === t.id}<span class="h-[5px] w-[5px] rounded-pill bg-crimson"></span>{/if}
                  {t.label}
                </button>
              {/each}
            </div>
          </div>
          <div class="flex items-center gap-1.5" class:opacity-30={!raceCard?.live} aria-hidden={raceCard?.live ? undefined : 'true'}>
            <span class="h-1.5 w-1.5 rounded-pill bg-crimson" class:animate-pulse={raceCard?.live}></span>
            <span class="text-[9px] font-extrabold tracking-[0.14em] text-on-mono/50">LIVE</span>
          </div>
        </div>
      {/snippet}
      <!-- Grid-stack: all three panes share one grid cell → card height stays constant across tabs -->
      <div id="hero-pane" role="tabpanel" aria-labelledby="hero-tab-{heroTab}" class="grid">
      <div class="col-start-1 row-start-1 transition-opacity duration-150 ease-out" class:opacity-0={heroTab !== 'today'} inert={heroTab !== 'today'}>
      <div class="flex items-center gap-5">
        <div class="relative shrink-0">
          <svg width="112" height="112" viewBox="0 0 112 112">
            <defs>
              <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#ff4d5e" />
                <stop offset="100%" stop-color="#e8102e" />
              </linearGradient>
            </defs>
            <circle cx="56" cy="56" r={R} fill="none" stroke="#23252c" stroke-width="10" />
            <circle
              cx="56"
              cy="56"
              r={R}
              fill="none"
              stroke="url(#ringGrad)"
              stroke-width="10"
              stroke-linecap="round"
              stroke-dasharray="{ringDash} {CIRC}"
              transform="rotate(-90 56 56)"
              style="filter: drop-shadow(0 2px 8px rgba(232, 16, 46, 0.55));"
            />
          </svg>
          <div class="absolute inset-0 grid place-items-center">
            <div class="text-center">
              <p class="text-[26px] leading-none font-extrabold text-on-mono text-tabular">
                {readiness === null ? '—' : readiness + '%'}
              </p>
              <p class="text-[9px] font-bold uppercase tracking-wider text-on-mono-dim mt-1">Readiness</p>
            </div>
          </div>
        </div>
        <div class="min-w-0 flex-1 flex flex-col gap-3">
          <div>
            <p class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">Form (TSB)</p>
            <p class="text-metric-lg font-extrabold text-rose text-tabular leading-tight">
              {tsbVal === null ? '—' : (tsbVal > 0 ? '+' : '') + tsbVal}
            </p>
          </div>
          <div class="text-[11px] font-bold uppercase tracking-wider text-on-mono-dim">
            <p>{readinessLabel}</p>
            <p class="mt-0.5 text-on-mono-dim normal-case font-medium tracking-normal">
              CTL {ctlVal ?? '—'} · ATL {atlVal ?? '—'}
            </p>
          </div>
        </div>
      </div>
      <div class="pt-4 border-t border-[#2b2d33] grid grid-cols-3 text-center">
        <div>
          <p class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">Time</p>
          <p class="text-base font-extrabold text-on-mono text-tabular mt-0.5">{week.hours}h</p>
        </div>
        <div class="border-x border-[#2b2d33]">
          <p class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">Distance</p>
          <p class="text-base font-extrabold text-on-mono text-tabular mt-0.5">{fmtDist(week.km, 0)}</p>
        </div>
        <div>
          <p class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">Stress</p>
          <p class="text-base font-extrabold text-rose text-tabular mt-0.5">{week.tss} TSS</p>
        </div>
      </div>
      </div>
      <div class="col-start-1 row-start-1 transition-opacity duration-150 ease-out" class:opacity-0={heroTab !== 'form'} inert={heroTab !== 'form'}>
      <div class="flex flex-col gap-1">
        <div class="flex items-baseline justify-between">
          <span class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">Form · last 30 days</span>
          {#if taperDelta !== null}
            <span class="text-[11px] font-bold text-tabular text-rose">{taperDelta >= 0 ? '+' : ''}{taperDelta} pts / 7d</span>
          {/if}
        </div>
        <div class="-mx-1">
          <Sparkline points={tsbSpark} width={352} height={96} showBaseline onDark ariaLabel="Form TSB last 30 days" />
        </div>
        <div class="pt-4 border-t border-[#2b2d33] grid grid-cols-3 text-center">
          <div>
            <p class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">Fitness</p>
            <p class="text-base font-extrabold text-on-mono text-tabular mt-0.5">CTL {ctlVal ?? '—'}</p>
          </div>
          <div class="border-x border-[#2b2d33]">
            <p class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">Fatigue</p>
            <p class="text-base font-extrabold text-on-mono text-tabular mt-0.5">ATL {atlVal ?? '—'}</p>
          </div>
          <div>
            <p class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">Form</p>
            <p class="text-base font-extrabold text-rose text-tabular mt-0.5">
              {tsbVal === null ? '—' : (tsbVal > 0 ? '+' : '') + tsbVal} TSB
            </p>
          </div>
        </div>
      </div>
      </div>
      <div class="col-start-1 row-start-1 transition-opacity duration-150 ease-out" class:opacity-0={heroTab !== 'load'} inert={heroTab !== 'load'}>
      <div class="flex flex-col gap-1">
        <div class="flex items-baseline justify-between">
          <span class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">Daily load · last 7 days</span>
          <span class="text-[11px] font-bold text-tabular text-on-mono">{week.tss} TSS / wk</span>
        </div>
        <TssBars days={week.dailyTss} target={tssTarget} onDark />
      </div>
      </div>
      </div>
    </SectionCard>

    <!-- SNAPSHOT TILES -->
    <section class="grid grid-cols-2 gap-3">
      <StatTile
        label="Threshold FTP"
        value={ftpVal ? String(ftpVal) : '—'}
        unit="W"
        delta={ftpDelta ? `${ftpDelta.dir === 'up' ? '+' : '−'}${ftpDelta.w}W vs ${ftpDelta.days}d ago` : undefined}
        deltaTone={ftpDelta?.dir === 'down' ? 'down' : 'up'}
      />
      <StatTile
          label="Power / weight"
          value={wkg?.value ?? '—'}
          unit={wkg?.unit ?? ''}
          sub={weight ? `At ${formatWeight(weight.current, unit)}` : undefined}
        />
      <StatTile label="Fitness (CTL)" value={ctlVal ? String(ctlVal) : '—'} sub={taperDelta !== null ? `${taperDelta >= 0 ? '+' : ''}${taperDelta} pts form / 7d` : 'Chronic load'} />
      <StatTile
        label="Form (TSB)"
        value={tsbVal === null ? '—' : (tsbVal > 0 ? '+' : '') + String(tsbVal)}
        unit="TSB"
        variant="flare"
      />
    </section>

    <!-- LAST 7 DAYS -->
    <SectionCard kicker="Last 7 days">
      <div class="flex flex-col gap-5">
        <StatTrio
          items={[
            { label: 'Rides', value: String(ridesThisWeek) },
            { label: 'Distance', value: fmtDist(week.km, 0) },
            { label: 'Stress', value: `${week.tss}` }
          ]}
        />
        <TssBars days={week.dailyTss} target={tssTarget} />
      </div>
    </SectionCard>

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
      <div class="mt-3 pt-3 border-t border-hairline flex items-center justify-between text-[11px]">
        <span class="text-ink-dim font-medium">30-day form progression</span>
        {#if taperDelta !== null}
          <span class="font-bold text-tabular text-ink">{taperDelta >= 0 ? '+' : ''}{taperDelta} pts</span>
        {/if}
      </div>
      <div class="mt-2">
        <Sparkline points={tsbSpark} width={360} height={40} showBaseline ariaLabel="Form TSB last 30 days" />
      </div>
    </SectionCard>

    <!-- POWER CURVE -->
    <SectionCard kicker="Power curve">
      {#snippet right()}
        <LegendPill
          items={[
            { label: 'Best effort', dot: 'signal' },
            { label: cpFit ? `CP/W' model · R² ${cpFit.r2.toFixed(3)}` : "CP/W' model", dot: 'outline' }
          ]}
        />
      {/snippet}
      <PowerCurveChart curve={mergedCurve} fit={cpFit} />
      <div class="mt-4 pt-3 border-t border-hairline">
        <StatTrio
          items={[
            { label: 'Critical power', value: cpFit ? `${cpFit.cp}` : '—' },
            { label: "W'", value: cpFit ? `${(cpFit.wPrime / 1000).toFixed(1)} kJ` : '—' },
            {
              label: 'Time to empty',
              value: tlimLabel
            }
          ]}
        />
      </div>
      <p class="mt-2 text-[11px] font-medium text-ink-dim">
        {#if cpFit}
          Fitted across {cpFit.points} durations from {curveRides} power ride{curveRides === 1 ? '' : 's'}
          · W' empties at CP; below it, power is borrowed, not earned.
        {:else}
          Ride with a power meter (FIT or Strava) to fit the critical power model.
        {/if}
      </p>
    </SectionCard>

    <!-- REMINDERS & RACE -->
    <SectionCard kicker="Reminders & race">
      <div class="flex flex-col divide-y divide-hairline">
        {#if worstWear}
          <a
            href="#/gear"
            class="pb-4 flex flex-col gap-2.5 group"
            aria-label="Open gear — {worstWear.comp.name} wear {Math.round(worstWear.pct * 100)}%"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="grid h-10 w-10 place-items-center rounded-pill bg-tile border border-hairline text-ink">
                  <Wrench size={19} strokeWidth={1.5} />
                </div>
                <div class="flex flex-col">
                  <span class="text-sm font-bold text-ink tracking-tight">{worstWear.comp.name}</span>
                  <span class="text-xs text-ink-dim text-tabular">
                    {Math.round(convertDistance(worstWear.usedKm, unit)).toLocaleString()} / {Math.round(convertDistance(worstWear.comp.intervalKm, unit)).toLocaleString()} {distLabel} ({Math.round(worstWear.pct * 100)}%)
                  </span>
                  <span class="text-[10px] font-extrabold uppercase tracking-wider text-crimson-deep">Manage gear →</span>
                </div>
              </div>
              <StatusChip label={worstWear.status} status={worstWear.status} icon={worstWear.status === 'kritis' ? 'alert' : 'warn'} />
            </div>
            <HatchTrack pct={worstWear.pct} status={worstWear.status} />
          </a>
        {/if}

        {#if raceCard}
          <a
            href="#/race"
            class="pt-4 flex flex-col gap-2.5"
            aria-label="Open race — {raceCard.name}"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="grid h-10 w-10 place-items-center rounded-pill bg-tile border border-hairline {raceCard.live ? 'text-crimson' : 'text-crimson'}">
                  {#if raceCard.live}
                    <span class="h-2.5 w-2.5 rounded-pill bg-crimson animate-pulse"></span>
                  {:else}
                    <Calendar size={19} strokeWidth={1.5} />
                  {/if}
                </div>
                <div class="flex flex-col">
                  <span class="text-sm font-bold text-ink tracking-tight">{raceCard.name}</span>
                  <span class="text-xs text-ink-dim">{raceCard.subtitle}</span>
                  {#if raceCard.km}
                    <span class="text-[10px] font-extrabold uppercase tracking-wider text-crimson-deep">{fmtDist(raceCard.km)} route · view plan →</span>
                  {:else}
                    <span class="text-[10px] font-extrabold uppercase tracking-wider text-crimson-deep">View plan →</span>
                  {/if}
                </div>
              </div>
              <span class="grid h-8 w-8 place-items-center rounded-pill bg-mono text-on-mono">
                <ArrowUpRight size={16} strokeWidth={1.5} />
              </span>
            </div>
            {#if !raceCard.live}
              <HatchTrack pct={raceProgress} status="signal" />
            {/if}
          </a>
        {:else}
          <a href="#/routes" class="pt-4 flex items-center justify-between" aria-label="Plan your first race">
            <div class="flex items-center gap-3">
              <div class="grid h-10 w-10 place-items-center rounded-pill bg-tile border border-hairline text-ink-dim">
                <Flag size={19} strokeWidth={1.5} />
              </div>
              <div class="flex flex-col">
                <span class="text-sm font-bold text-ink tracking-tight">No race planned yet</span>
                <span class="text-[10px] font-extrabold uppercase tracking-wider text-crimson-deep">Import a route & set a plan →</span>
              </div>
            </div>
            <span class="grid h-8 w-8 place-items-center rounded-pill bg-mono text-on-mono">
              <ArrowUpRight size={16} strokeWidth={1.5} />
            </span>
          </a>
        {/if}
      </div>
    </SectionCard>
  {:else}
    <div class="rounded-card bg-surface border border-hairline p-8 text-center elevation-card">
      <span class="kicker">Loading telemetry…</span>
    </div>
  {/if}
</div>
