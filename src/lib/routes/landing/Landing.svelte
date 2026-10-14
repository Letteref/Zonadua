<script lang="ts">
  /**
   * Welcome landing — the first screen a fresh device sees, before setup.
   *
   * Art direction: athletic poster, after the Nike Run Club school — a full-bleed dark
   * hero with an oversized wordmark, a red slash as the only ornament, and the product         * card overlapping the hero's bottom edge. The rest is the app's own Crimson Clean
   * system: white cards, hairlines, tabular numbers, crimson reserved for accents.
   *
   * The sample card shows three flagship views behind three tabs, each computed by the
   * real domain code and labelled SAMPLE (the Routes page's fallback-profile contract):
   * - FORM: the dashboard's training-form monolith plus a stats strip under the band
   *   meter, all solved from one sample training history.
   * - PROJECTION: the Routes page physics solve over a sample GPX profile, with the         *   estimated finish time as the visual hero and the elevation profile reduced to a         *   decorative area beneath it.
   * - LIVE RACE: the Race cockpit as a running simulation — buffer against the cut-off         *   time in huge type, elapsed / projected / required around it, and a distance log         *   track with the rider's marker advancing along it.
   *
   * Below the sample card, a plain list card names the side features that are not
   * visualisations. Everything reads fixed sample inputs, never the database, so a fresh
   * or wiped device always shows the same numbers.
   *
   * Motion: the tabs rotate every few seconds with a progress rail; the race view runs a         * fast-forward simulation. Both are decoration: the rotation ends the moment the rider         * takes a tab over, and prefers-reduced-motion skips the rotation, parks the race at a         * mid-route frame and collapses every entrance animation (global override, app.css).
   */
  import { onMount } from 'svelte';
  import Logo from '$lib/components/Logo.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import BandMeter from '$lib/components/BandMeter.svelte';
  import Sparkline from '$lib/components/Sparkline.svelte';
  import { computePmc, formState, isoLocalDay, type PmcInput } from '$lib/domain/pmc';
  import { buildPlan, clockOf, durationOf, planSeries } from '$lib/domain/pacing';
  import type { ProfilePoint } from '$lib/domain/physics';
  import type { IconName } from '$lib/icons';

  let { onstart }: { onstart: () => void } = $props();

  // ---------- the sample card's three views ----------

  const TABS = [
    { id: 'form', label: 'Form' },
    { id: 'projection', label: 'Projection' },
    { id: 'race', label: 'Race' }
  ] as const;
  type TabId = (typeof TABS)[number]['id'];
  let tab = $state<TabId>('form');

  /** Auto-advance interval for the sample card, in ms. Decoration, never a gate. */
  const AUTO_MS = 5000;

  /** Whether the card is still rotating on its own. The rider taking over ends it for good. */
  let auto = $state(true);

  /** Manual pick: show that view and stop the rotation — the rider is driving now. */
  function pickTab(id: TabId): void {
    tab = id;
    auto = false;
  }

  // ---------- view 1: training form (PMC over a sample history) ----------

  /** A plausible training week: two hard days, one long day, two easy, two off. */
  const SAMPLE_WEEK: readonly number[] = [100, 60, 120, 0, 90, 150, 0];

  /**
   * The sample history: a full week of rest ends the window, so the ramp decays into a
   * fresh +TSB instead of freezing mid-hard-block, then five weeks of the week repeat.
   */
  const sampleHistory = (): PmcInput[] => {
    const now = new Date();
    const out: PmcInput[] = [];
    for (let d = 0; d < 42; d++) {
      const tss = d < 7 ? 0 : SAMPLE_WEEK[(d - 7) % SAMPLE_WEEK.length];
      const day = new Date(now);
      day.setDate(now.getDate() - d);
      out.push({ date: isoLocalDay(day), tss });
    }
    return out;
  };

  /** One PMC solve over the sample history: today's numbers plus the CTL line behind them. */
  const form = $derived.by(() => {
    const series = computePmc(sampleHistory(), 42);
    const last = series[series.length - 1];
    return {
      ctl: last.ctl,
      atl: last.atl,
      tsb: last.tsb,
      state: formState(last.tsb),
      fitness: series.map((p) => p.ctl)
    };
  });

  /** The stats strip under the band meter — read off the sample week, not invented. */
  const formStats = [
    { label: 'Week load', value: String(SAMPLE_WEEK.reduce((s, v) => s + v, 0)), unit: 'TSS' },
    { label: 'Ride days', value: String(SAMPLE_WEEK.filter((v) => v > 0).length), unit: '/ wk' },
    { label: 'Best day', value: String(Math.max(...SAMPLE_WEEK)), unit: 'TSS' }
  ] as const;

  // ---------- view 2 & 3: the route solve (projection + live race) ----------

  /** 42 km with two real climbs and a fast descent between them — a sample GPX profile. */
  const SAMPLE_PROFILE: ProfilePoint[] = [
    { distKm: 0, altM: 120 },
    { distKm: 3, altM: 80 },
    { distKm: 7, altM: 60 },
    { distKm: 11, altM: 240 },
    { distKm: 14, altM: 420 },
    { distKm: 16, altM: 430 },
    { distKm: 19, altM: 300 },
    { distKm: 23, altM: 140 },
    { distKm: 26, altM: 110 },
    { distKm: 30, altM: 150 },
    { distKm: 33, altM: 300 },
    { distKm: 36, altM: 340 },
    { distKm: 39, altM: 220 },
    { distKm: 42, altM: 90 }
  ];

  /**
   * One physics solve with the same rider inputs the Routes page defaults to. The
   * projection view and the race simulation both read this same plan, so the estimate         * and the cockpit can never describe different rides.
   */
  const route = $derived.by(() => {
    const plan = buildPlan({
      profile: SAMPLE_PROFILE,
      physics: {
        riderKg: 68,
        bikeKg: 9.4,
        cargoKg: 3,
        crr: 0.0045,
        cda: 0.32,
        temperatureC: 20,
        headwindKph: 0
      },
      pacing: { mode: 'if', ifTarget: 0.72, ftp: 275 },
      stops: { count: 2, minutesEach: 15 },
      startMin: 5 * 60 + 30
    });
    const km = SAMPLE_PROFILE[SAMPLE_PROFILE.length - 1].distKm;
    const elapsedSec = plan.elapsedSec ?? 0;
    return {
      rows: planSeries(plan),
      watts: plan.targetWatts,
      km,
      climbM: Math.round(plan.climbM ?? 0),
      est: elapsedSec > 0 ? durationOf(elapsedSec) : '—',
      moving: durationOf(plan.movingSec ?? 0),
      finishClock: plan.finishClockMin != null ? clockOf(plan.finishClockMin) : '—',
      kcal: Math.round((plan.energyKJ ?? 0) / 4.184),
      walls: plan.powerLimitedCount ?? 0,
      elapsedSec,
      avgKph: elapsedSec > 0 ? km / (elapsedSec / 3600) : 0
    };
  });

  // ---------- live race simulation ----------

  /** Cut-off time for the sample race, seconds (2 h 10 m against a ~2 h plan). */
  const COT_SEC = 2 * 3600 + 10 * 60;

  /** Wall seconds for one full fast-forward pass of the route. */
  const SIM_SEC = 45;

  /** Simulated progress, 0..1, plus the wobble that keeps the readouts breathing. */
  let simT = $state(0);

  const race = $derived.by(() => {
    const wobble = 1 + 0.05 * Math.sin(simT * 1.7);
    const progress = Math.min(1, (simT * wobble) / SIM_SEC);
    const km = route.km * progress;
    const elapsed = route.elapsedSec * progress;
    const remainKph = Math.max(4, route.avgKph * wobble);
    const projected = elapsed + ((route.km - km) / remainKph) * 3600;
    const buffer = COT_SEC - projected;
    const remainSec = Math.max(60, COT_SEC - elapsed);
    const required = ((route.km - km) / remainSec) * 3600;
    return {
      km,
      elapsed,
      projected,
      buffer,
      required,
      cotLabel: '2:10',
      done: progress >= 1
    };
  });

  /** hh:mm:ss for the ticking cockpit readouts. */
  const clockSec = (s: number): string => {
    const sec = Math.max(0, Math.floor(s));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const ss = sec % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };

  /** The profile as bare altitude numbers — the decorative area under the estimate. */
  const profileAlts = $derived(route.rows.map((r) => r.altM));

  /** Where the profile peaks, so the mini chart can point at it instead of decorating. */
  const profilePeak = $derived.by(() => {
    let best = route.rows[0] ?? { km: 0, altM: 0 };
    for (const r of route.rows) if (r.altM > best.altM) best = r;
    return { km: best.km, altM: Math.round(best.altM) };
  });

  // ---------- rotation + simulation driver ----------

  onMount(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      auto = false;
      simT = SIM_SEC * 0.42; // park the race mid-route: a still frame, not a dead box
      return;
    }
    let ticks = 0;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      if (tab === 'race' && !race.done) simT += 0.2;
      if (!auto) return;
      ticks += 1;
      if (ticks * 200 >= AUTO_MS) {
        ticks = 0;
        const i = TABS.findIndex((t) => t.id === tab);
        tab = TABS[(i + 1) % TABS.length].id;
      }
    }, 200);
    return () => window.clearInterval(id);
  });

  // ---------- side features (pills, not visualisations) ----------

  const SIDE_PILLS = [
    { icon: 'wrench', label: 'Gear & bikes' },
    { icon: 'bell', label: 'Reminders' },
    { icon: 'chart-line', label: 'Training load' }
  ] as const satisfies readonly { icon: IconName; label: string }[];
</script>

<div class="fixed inset-0 z-40 flex flex-col bg-canvas">
  <main class="min-h-0 flex-1 overflow-y-auto">
    <!-- Hero: full-bleed dark poster block; the product card overlaps its bottom edge -->
    <section class="bg-mono-gradient px-5 pt-7 pb-10 text-on-mono">
      <div class="flex items-center gap-2 landing-enter">
        <Logo size={24} />
        <span class="text-[11px] font-extrabold uppercase tracking-[0.18em] text-on-mono-dim">
          Cycling performance lab
        </span>
      </div>

      <h1
        class="mt-6 text-[44px] font-extrabold uppercase leading-[0.92] tracking-[-0.03em] landing-enter"
        style="animation-delay:60ms"
      >
        Zonadua
      </h1>
      <span
        class="mt-2.5 block h-[6px] w-16 -skew-x-12 rounded-full bg-crimson landing-enter"
        style="animation-delay:100ms"
        aria-hidden="true"
      ></span>

      <p class="mt-4 text-sm font-medium leading-relaxed text-on-mono-dim landing-enter" style="animation-delay:140ms">
        Performance, route estimation, and race-day tracking, computed from your rides on Strava.
        <span class="italic font-semibold text-rose">Connect once, and new rides sync on their own.</span>
      </p>

      <p
        class="mt-4 text-[9px] font-extrabold uppercase tracking-[0.14em] text-on-mono-dim landing-enter"
        style="animation-delay:180ms"
      >
        Race-day tracking · Strava sync · AI insights
      </p>
    </section>

    <div class="px-5 -mt-6 flex flex-col gap-4 relative z-10">
      <!-- Sample card: three flagship views take turns inside one box -->
      <section
        class="rounded-card bg-surface border border-hairline p-4 elevation-card landing-enter"
        style="animation-delay:220ms"
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Sample preview"
            class="flex gap-1 rounded-pill border border-hairline bg-tile p-1"
          >
            {#each TABS as t (t.id)}
              <button
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onclick={() => pickTab(t.id)}
                class="rounded-pill px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] transition-colors {tab === t.id
                  ? 'bg-ink text-white'
                  : 'text-ink-dim active:opacity-70'}"
              >
                {t.label}
              </button>
            {/each}
          </div>
          <span
            class="rounded-pill border border-hairline bg-tile px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.12em] text-ink-dim"
          >
            Sample
          </span>
        </div>

        <!-- Rotation progress: a 2px rail that empties once per tab and restarts on advance.
             The animation reference lives in the style block, not inline: Svelte scopes
             keyframe names, so an inline `animation:` shorthand would name a keyframe that
             no longer exists. -->
        {#if auto}
          <div class="mb-2 h-0.5 overflow-hidden rounded-full bg-tile" aria-hidden="true">
            {#key tab}
              <div
                class="landing-prog-fill h-full origin-left rounded-full bg-crimson"
                style="--landing-dur:{AUTO_MS}ms"
              ></div>
            {/key}
          </div>
        {/if}

        <!-- Fixed height: switching tabs must not nudge the CTA or grow the screen.
             296 px is the projection/race stack's exact height (readout band 62 + canvas
             110 + legend + strip); smaller bodies made the chart overlap the strip. -->
        <div class="h-[296px]">
          {#key tab}
            {#if tab === 'form'}
              <!-- Training form: the dashboard's dark monolith plus a stats strip -->
              <div
                role="tabpanel"
                class="landing-panel h-full rounded-2xl bg-mono-gradient p-4 text-on-mono flex flex-col justify-center gap-4"
              >
                <div class="min-w-0">
                  <span class="block text-[10px] font-bold uppercase tracking-[0.1em] text-on-mono-dim">
                    Training form
                  </span>
                  <!-- The curve lives on the metric row, not the title row: it is centred on
                       the TSB figure and starts under the label, so it can never ride above
                       the title or crowd the number. -->
                  <div class="mt-1.5 flex items-center justify-between gap-3">
                    <div class="flex items-baseline gap-2.5 min-w-0">
                      <span class="text-metric-lg text-tabular">{form.tsb > 0 ? '+' : ''}{form.tsb}</span>
                      <span class="text-[10px] font-extrabold uppercase tracking-[0.12em] text-rose">
                        {form.state}
                      </span>
                    </div>
                    <Sparkline points={form.fitness} width={110} height={36} onDark ariaLabel="Sample fitness trend" />
                  </div>
                  <div
                    class="mt-2 flex gap-4 text-[10px] font-bold uppercase tracking-[0.08em] text-on-mono-dim text-tabular"
                  >
                    <span>Fitness <span class="text-on-mono">{form.ctl}</span></span>
                    <span>Fatigue <span class="text-on-mono">{form.atl}</span></span>
                  </div>
                </div>

                <BandMeter tsb={form.tsb} ariaLabel="Sample form position" />

                <div class="grid grid-cols-3 gap-1.5">
                  {#each formStats as s (s.label)}
                    <div class="rounded-xl border border-white/10 bg-white/[0.06] py-2 text-center">
                      <div class="text-[8px] font-bold uppercase tracking-[0.1em] text-on-mono-dim">{s.label}</div>
                      <div class="text-[13px] font-extrabold text-on-mono text-tabular">
                        {s.value}<span class="ml-0.5 text-[9px] font-bold text-on-mono-dim">{s.unit}</span>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {:else if tab === 'projection'}
              <!-- Projection: a replica of the Routes page's "Projected ride time" deck —
                   twin tiles, the AVG/KCAL/NP strip, the four stat tiles, sample chip and all -->
              <div role="tabpanel" class="landing-panel h-full flex flex-col justify-center gap-2">
                <div class="rounded-2xl bg-mono text-on-mono glow-mono bg-mono-gradient p-3.5 flex flex-col gap-2">
                  <div class="flex items-center justify-between">
                    <span class="flex items-center gap-2">
                      <span class="h-1.5 w-1.5 rounded-pill bg-crimson"></span>
                      <span class="text-[11px] font-bold uppercase tracking-[0.08em] text-on-mono-dim">Projected ride time</span>
                    </span>
                    <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-pill bg-[#23252c] text-rose border border-[#2b2d33]">Sample plan</span>
                  </div>

                  <div class="grid grid-cols-2 gap-2.5">
                    <div class="rounded-2xl px-3 py-2.5 flex flex-col items-center justify-center text-center bg-[#23252c] border border-[#2b2d33] min-h-14">
                      <span class="text-[10px] font-extrabold uppercase tracking-wider text-on-mono-dim">Est finish</span>
                      <span class="text-[26px] font-extrabold text-rose text-tabular tracking-tight leading-none mt-0.5">{route.est}</span>
                      <span class="text-[9px] font-bold uppercase tracking-[0.1em] text-on-mono-dim text-tabular whitespace-nowrap mt-1.5">
                        Moving {route.moving}
                      </span>
                    </div>
                    <div class="rounded-2xl px-3 py-2.5 flex flex-col items-center justify-center text-center bg-[#23252c] border border-[#2b2d33] min-h-14">
                      <span class="text-[10px] font-extrabold uppercase tracking-wider text-on-mono-dim">Target arrive</span>
                      <span class="text-[26px] font-extrabold text-on-mono text-tabular tracking-tight leading-none mt-0.5">{route.finishClock}</span>
                      <span class="text-[9px] font-bold uppercase tracking-[0.1em] text-on-mono-dim text-tabular whitespace-nowrap mt-1.5">
                        WIB
                      </span>
                    </div>
                  </div>

                  <div class="flex items-center justify-center gap-2 pt-1 border-t border-[#2b2d33] text-[11px] font-bold uppercase tracking-[0.06em] whitespace-nowrap">
                    <span class="text-on-mono-dim">AVG <span class="text-on-mono">{route.avgKph.toFixed(1)} KM/H</span></span>
                    <span class="text-[#3f434b]">•</span>
                    <span class="text-on-mono-dim"><span class="text-on-mono">{route.kcal.toLocaleString()}</span> KCAL</span>
                    <span class="text-[#3f434b]">•</span>
                    <span class="text-rose">{route.watts} W NP</span>
                  </div>

                  <div class="grid grid-cols-4 gap-1.5">
                    <div class="flex items-center justify-center gap-1 py-1.5 px-1 rounded-xl bg-[#1b1c22] border border-[#2b2d33] text-on-mono">
                      <span class="text-[10px] font-bold text-tabular">{route.km.toFixed(1)} KM</span>
                    </div>
                    <div class="flex items-center justify-center gap-1 py-1.5 px-1 rounded-xl bg-[#1b1c22] border border-[#2b2d33] text-on-mono">
                      <span class="text-[10px] font-bold text-tabular text-rose">{route.climbM} M ↑</span>
                    </div>
                    <div class="flex items-center justify-center gap-1 py-1.5 px-1 rounded-xl bg-[#1b1c22] border border-[#2b2d33]">
                      <span class="h-1.5 w-1.5 rounded-pill bg-crimson"></span>
                      <span class="text-[9px] font-bold tracking-tight text-rose">SAMPLE</span>
                    </div>
                    <div class="flex items-center justify-center gap-1 py-1.5 px-1 rounded-xl bg-[#1b1c22] border border-[#2b2d33]">
                      <span class="text-[9px] font-bold uppercase text-on-mono-dim">{route.walls ? `${route.walls} WALL` : 'CAT HC'}</span>
                    </div>
                  </div>
                </div>

                <!-- Profile: the route's shape, pointed at its summit, on a km scale -->
                <div>
                  <div class="flex items-center justify-between text-[9px] font-extrabold uppercase tracking-[0.12em] text-ink-dim">
                    <span>Profile</span>
                    <span>Max <span class="text-ink">{profilePeak.altM} M</span></span>
                  </div>
                  <div class="relative mt-1 h-[46px]">
                    <Sparkline points={profileAlts} width={300} height={46} fill ariaLabel="Sample route elevation profile" />
                    <span
                      class="absolute -translate-x-1/2 rounded-pill bg-ink px-1.5 py-0.5 text-[8px] font-extrabold text-white text-tabular"
                      style="left:{((profilePeak.km / route.km) * 100).toFixed(1)}%; top:2px"
                    >
                      {profilePeak.altM} M @ {profilePeak.km.toFixed(0)} KM
                    </span>
                  </div>
                  <div
                    class="mt-1 flex justify-between border-t border-hairline text-[8px] font-bold text-ink-dim text-tabular"
                  >
                    <span>0</span><span>10</span><span>20</span><span>30</span><span>{route.km.toFixed(0)} KM</span>
                  </div>
                </div>
              </div>
            {:else}
              <!-- Live race: dark cockpit, buffer against the COT in huge type, and a
                   distance log track with the rider's marker advancing along it -->
              <div
                role="tabpanel"
                class="landing-panel h-full rounded-2xl bg-mono-gradient p-4 text-on-mono flex flex-col justify-center gap-3.5"
              >
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-bold uppercase tracking-[0.1em] text-on-mono-dim">Live race</span>
                  <span
                    class="rounded-pill border border-white/15 bg-white/10 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.12em] text-on-mono-dim"
                  >
                    COT {race.cotLabel}
                  </span>
                </div>

                <div>
                  <span class="text-[9px] font-extrabold uppercase tracking-[0.14em] text-on-mono-dim">Buffer vs cut-off</span>
                  <div class="text-[34px] font-extrabold leading-none text-tabular {race.buffer >= 0 ? 'text-rose' : 'text-on-mono-dim'}">
                    {race.buffer >= 0 ? '+' : '−'}{clockSec(Math.abs(race.buffer))}
                  </div>
                </div>

                <div class="grid grid-cols-3 gap-1.5 text-center">
                  <div>
                    <div class="text-[8px] font-bold uppercase tracking-[0.1em] text-on-mono-dim">Elapsed</div>
                    <div class="text-[13px] font-extrabold text-tabular">{clockSec(race.elapsed)}</div>
                  </div>
                  <div>
                    <div class="text-[8px] font-bold uppercase tracking-[0.1em] text-on-mono-dim">Projected</div>
                    <div class="text-[13px] font-extrabold text-tabular">{clockSec(race.projected)}</div>
                  </div>
                  <div>
                    <div class="text-[8px] font-bold uppercase tracking-[0.1em] text-on-mono-dim">Required</div>
                    <div class="text-[13px] font-extrabold text-tabular">
                      {race.required.toFixed(1)}<span class="text-[9px] font-bold text-on-mono-dim"> KM/H</span>
                    </div>
                  </div>
                </div>

                <!-- distance log: covered track, km ticks, live position dot -->
                <div>
                  <div class="relative h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      class="absolute inset-y-0 left-0 rounded-full bg-crimson"
                      style="width:{((race.km / route.km) * 100).toFixed(2)}%"
                    ></div>
                    <span
                      class="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-mono bg-white"
                      style="left:{((race.km / route.km) * 100).toFixed(2)}%"
                    ></span>
                  </div>
                  <div class="mt-1 flex justify-between text-[8px] font-bold text-on-mono-dim text-tabular">
                    <span>0</span><span>10</span><span>20</span><span>30</span><span>{route.km.toFixed(0)}</span>
                  </div>
                </div>

                <!-- Log checkpoint, the cockpit's one big input, echoed as a visual -->
                <div class="flex items-center gap-2">
                  <div class="flex h-10 flex-1 items-center justify-between rounded-xl bg-white/[0.06] border border-white/10 px-3">
                    <span class="text-[13px] font-extrabold text-on-mono-dim">KM</span>
                    <span class="text-[9px] font-bold uppercase text-on-mono-dim">current</span>
                  </div>
                  <div class="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-crimson-fill px-4 text-white text-[11px] font-extrabold uppercase tracking-wider">
                    <Icon name="plus" size={15} strokeWidth={2.4} />
                    Log
                  </div>
                </div>
              </div>
            {/if}
          {/key}
        </div>
      </section>

        <!-- Side features: one horizontal row of pills, the parts that are not visualisations.
             Tighter px/text than the default pill so all three fit one line at 390px without
             wrapping (Gear & bikes · Reminders · Training load ≈ 300px of the 350px available).
             flex-1: each pill grows to share the row evenly, so the row's left and right edges
             land exactly on the sample card's edges instead of stopping short on the right. -->
      <div class="pt-1 landing-enter" style="animation-delay:280ms">
        <div class="flex gap-1.5">
          {#each SIDE_PILLS as p (p.label)}
            <span
              class="flex flex-1 min-w-0 items-center justify-center gap-1 rounded-pill border border-hairline bg-surface px-2 py-1 elevation-card"
            >
              <Icon name={p.icon} size={12} strokeWidth={1.8} class="text-crimson" />
              <span class="text-[9px] font-extrabold uppercase tracking-[0.05em] text-ink whitespace-nowrap">{p.label}</span>
            </span>
          {/each}
        </div>
      </div>
    </div>
  </main>

  <footer class="shrink-0 px-5 pt-3 pb-8">
    <button
      type="button"
      onclick={onstart}
      class="h-12 w-full rounded-full bg-crimson-fill text-white text-[11px] font-extrabold uppercase tracking-[0.14em] active:scale-[0.98]"
    >
      Get started
    </button>
    <p class="mt-2.5 text-center text-[11px] font-medium text-ink-dim">
      Five steps to set your baseline. Skip setup anytime.
    </p>
  </footer>
</div>

<style>
  /*
   * Motion is decoration layered on a screen that is fully readable without it. The
   * global prefers-reduced-motion override in app.css collapses every duration to
   * 0.01 ms, so these keyframes end in their final state instantly for those riders,
   * and the rotation timer is skipped outright in onMount.
   */
  @keyframes landing-prog {
    from {
      transform: scaleX(0);
    }
    to {
      transform: scaleX(1);
    }
  }

  @keyframes landing-rise {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  /* Entrance: hero pieces stagger in via inline animation-delay, the cards last. */
  .landing-enter {
    animation: landing-rise 0.45s cubic-bezier(0.22, 0.61, 0.36, 1) both;
  }

  /* Panel swap: each view settles in quickly when the tabs rotate or are clicked. */
  .landing-panel {
    animation: landing-rise 0.22s ease-out both;
  }

  /* Rotation rail: refilled per tab via {#key tab} remount, emptied over one interval. */
  .landing-prog-fill {
    animation: landing-prog var(--landing-dur) linear forwards;
  }
</style>
