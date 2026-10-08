<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
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
    appSettings,
    allRoutes,
    nextRace,
    powerCurves,
    computeWeek,
    computePmc,
    computeWear,
    formState,
    hasPmcLoad,
    latestWeight
  } from '$lib/data/queries.svelte';
  import { fitCriticalPower, mergePowerCurves, wPrimeExhaustionTime } from '$lib/domain/power-curve';
  import { fmtDuration } from '$lib/domain/zones';
  import { convertDistance, distanceUnit, formatDistance, formatPowerPerWeight, formatWeight, splitValue, type UnitSystem } from '$lib/domain/units';
  import { isCyclingActivity } from '$lib/data/db';
  
  // H2 hero chrome: window tabs swap the monolith body (§17 UI-SPEC)
  type HeroTab = 'today' | 'form' | 'load';
  const HERO_TABS: { id: HeroTab; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'form', label: 'Form' },
    { id: 'load', label: 'Load' }
  ];
  let heroTab = $state<HeroTab>('today');

  /**
   * Human labels for the published form bands in `domain/pmc.ts`.
   *
   * These replace the invented readiness thresholds (`>= 70`, `>= 45`) that used to pick
   * the hero's status line. The bands themselves are not this app's invention — they are
   * the standard TSB interpretation, already encoded in `formState` — so the words come
   * from the same source as the number and cannot drift apart from it.
   */
  const FORM_LABELS: Record<ReturnType<typeof formState>, string> = {
    fresh: 'RECOVER FIRST',
    detraining: 'DETRAINING',
    balanced: 'BALANCED',
    productive: 'BUILDING',
    peaking: 'PEAKED'
  };

  /**
   * Tone per form band, for the band name on the dark hero only.
   *
   * `text-aman` / `text-warn` / `text-kritis` are the *light* surfaces' tokens (#0a7450 and
   * friends) and they disappear against the monolith, so the hero borrows the same hexes
   * `StatusChip` already uses in its `dark` palette rather than inventing a third set.
   *
   * The colour goes on the name only. The pill that holds it keeps the two load cards' neutral
   * chrome: a whole chip tinted by band reads as a warning the other two are exempt from, while
   * a highlighted name inside a neutral chip reads as exactly what it is.
   */
  const FORM_TONES: Record<ReturnType<typeof formState>, string> = {
    fresh: '#ff8a92',
    detraining: '#ffb35a',
    balanced: '#f7f8fa',
    productive: '#ff4d5e',
    peaking: '#ff4d5e'
  };

  // Display units only — stored data stays metric, so nothing here can corrupt a metric.
  const unit = $derived<UnitSystem>(appSettings.current?.unit ?? 'metric');
  const fmtDist = $derived((km: number, digits = 1) => formatDistance(km, unit, digits));
  const distLabel = $derived(distanceUnit(unit));

  const week = $derived(computeWeek(allActivities.current ?? []));

  // True only when nothing here was ever measured — see the DEMO DATA chip below.
  const allDemo = $derived.by(() => {
    const acts = allActivities.current ?? [];
    return acts.length > 0 && acts.every((a) => a.synthetic === true);
  });
  const ridesThisWeek = $derived.by(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 6);
    cutoff.setHours(0, 0, 0, 0);
    return (allActivities.current ?? []).filter((a) => isCyclingActivity(a) && new Date(a.date) >= cutoff).length;
  });
  const pmc = $derived(computePmc(allActivities.current ?? [], 90));
  const lastPmc = $derived(pmc.at(-1));
  const tsbSpark = $derived(pmc.slice(-30).map((p) => p.tsb));

  /**
   * Whether the window holds any load, which is what separates "measured zero" from "no ride
   * yet". `computePmc` walks the window from CTL=ATL=0 by design, so a rider who has never
   * ridden still gets a full-length curve of zeros — and `formState(0)` is `balanced`. The
   * dashboard was therefore telling someone who had never trained that their fitness and
   * fatigue were perfectly balanced.
   *
   * Gating on this rather than on `lastPmc` alone is what makes the existing "no data"
   * rendering reachable: the hero already draws `—` for a null CTL/ATL/TSB and the pill already
   * has a `NO DATA` label and tone, but that branch only fired when there was no PMC row at all,
   * which a 90-day window always has.
   *
   * See `hasPmcLoad` for why the series is the right thing to test.
   */
  const hasLoad = $derived(hasPmcLoad(pmc));
  // M2: merged mean-max curve + CP/W' fit — best effort at each duration, then the
  // minimal model P = W'/t + CP fitted across every activity that carries power.
  const mergedCurve = $derived(mergePowerCurves((powerCurves.current ?? []).map((c) => c.points)));
  const cpFit = $derived(mergedCurve.length >= 4 ? fitCriticalPower(mergedCurve) : undefined);
  const wPrimeTlim = $derived(cpFit ? wPrimeExhaustionTime(cpFit) : undefined);
  /**
   * `wPrimeExhaustionTime` returns **seconds** — W′/CP is J/W, and its unit test pins it
   * (20000 J / 250 W = 80). This label used to format that number as if it were minutes,
   * so the card showed "1h 05m" for what the model puts at 65 s: a 60× overstatement of
   * the tank. `fmtDuration` is the same helper this card's own "longest measured effort"
   * line already uses, so both durations on the card render through one convention.
   */
  const tlimLabel = $derived.by(() => {
    if (wPrimeTlim === undefined) return '—';
    return fmtDuration(wPrimeTlim);
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
  const tsbVal = $derived(hasLoad ? Math.round(lastPmc!.tsb) : null);
  const ctlVal = $derived(hasLoad ? Math.round(lastPmc!.ctl) : null);
  const atlVal = $derived(hasLoad ? Math.round(lastPmc!.atl) : null);
  // The ring used to show a "Readiness %" computed as `clamp(55 + TSB × 1.4, 5, 95)` — an
  // invented linear map with no physiological basis, drawn as a confident donut beside a
  // label ("READY TO PUSH") that carried the authority of a real metric. Its own comment
  // promised the replacement would arrive with M2; M2 landed and the line was never
  // revisited, so the app has been showing an invented number wearing a real one's name.
  //
  // What survives is the pair that can actually be defended: TSB itself, which is measured
  // from the daily load series, and the published form bands already implemented in
  // `formState`. The ring is now a **gauge** — it places TSB on the ±40 form range and
  // reports no unit, so there is nothing there for it to be mistaken for.
  const FORM_SPAN = 40;
  const formLabel = $derived(tsbVal === null ? 'NO DATA' : FORM_LABELS[formState(tsbVal)]);
  const formTone = $derived(tsbVal === null ? '#9ba1aa' : FORM_TONES[formState(tsbVal)]);

  /**
   * The two load tiles under the form gauge.
   *
   * They were a raised, bordered card each, sitting beside a 112px ring (before §42), then bare
   * figures on the card's axis under a hairline (§43), and are inset tiles as of §45 — not the
   * old raised cards: each figure sits in a tile with a bar under it placing the value on a
   * shared 0–60 scale. The bare pair showed two numbers with nothing to say whether 22 and 33
   * were a lot or a little; the bar is the context, and it is what makes the pair readable at a
   * glance instead of against memory of what CTL usually runs.
   *
   * Each figure keeps the three-line rhythm the rest of the app's stats use — label, figure,
   * unit — rather than a run-on "23 CTL", because the unit carries a smaller, dimmer type than
   * the figure and one string would flatten the two.
   *
   * `pct` clamps at the scale's own end: a block above 60 fills the track rather than spilling
   * past it, so the bar never draws a position the caption's 0–60 does not cover.
   */
  const loadBarPct = (v: number | null) =>
    v === null ? 0 : Math.round((Math.min(60, Math.max(0, v)) / 60) * 100);
  const HERO_LOAD_TILES = $derived([
    { label: 'Fitness', value: ctlVal ?? '—', unit: 'CTL', tone: 'text-on-mono', pct: loadBarPct(ctlVal) },
    { label: 'Fatigue', value: atlVal ?? '—', unit: 'ATL', tone: 'text-on-mono', pct: loadBarPct(atlVal) }
  ] as const);
  const ringFrac = $derived(
    tsbVal === null ? 0 : Math.max(0, Math.min(1, (tsbVal + FORM_SPAN) / (FORM_SPAN * 2)))
  );
  const R = 75;
  const CIRC = 2 * Math.PI * R;

  /**
   * The ring is a 240° gauge with its bottom open, not a progress spinner.
   *
   * As a full circle it read as a percentage — 30% of the way round for a TSB of −16 — with
   * the arc's mass thrown into the upper-right quadrant while the number sat dead centre, so
   * the eye took the *number* for the off-centre element. Opening the bottom makes the arc
   * symmetric about the vertical axis by construction.
   *
   * It is also the only honest way to draw the ±40 scale the number is measured against: the
   * two open ends are TSB −40 and +40, and the tick at the top is TSB 0. A full ring had
   * nowhere to put that tick, so the scale was invisible — which is how a 30% arc came to
   * look like "30% readiness", the exact fiction §36 removed.
   */
  const GAUGE_START = 150; // degrees from 3 o'clock, clockwise: the gauge's lower-left end
  const GAUGE_ARC = (240 / 360) * CIRC;
  const GAUGE_SWEEP = 240;
  const STROKE = 12;
  const GAUGE_BOX = 180; // the svg's own width and height
  const GAUGE_C = GAUGE_BOX / 2; // the ring's centre, in the svg's own coordinates

  /**
   * The arc does not fill its box, so the box's centre is not the ring's centre.
   *
   * The painted shape starts at the very top of the box — `R` plus half the stroke above the
   * axis — and stops at the two round caps, which sit at 30° and 150°, where the arc has
   * fallen only R/2 = 37.5px below the axis. So the mass spans 9..133.5 of the 180px box and
   * its centre is 71.25, against the box's centre at 90 — 18.75px, or exactly `R/4`, high.
   *
   * Anything centred on the box therefore reads as sitting too low inside the ring: the rider
   * sees the arc, not the box. `ARC_RISE` is that difference, and it is derived from the
   * geometry rather than typed, so it cannot drift away from the ring it describes.
   */
  const ARC_TOP = GAUGE_BOX / 2 - (R + STROKE / 2);
  const ARC_BOTTOM =
    GAUGE_BOX / 2 +
    (R * Math.sin(((GAUGE_START + GAUGE_SWEEP) % 360) * (Math.PI / 180)) + STROKE / 2);
  const ARC_RISE = GAUGE_BOX / 2 - (ARC_TOP + ARC_BOTTOM) / 2;

  /**
   * The three panes share one grid cell, so the card is exactly as tall as its tallest pane —
   * the Today pane. The Form and Load panes are shorter than that, which used to leave 22px and
   * 59px of dead air at the foot of those panes: the sparkline and the bars were given fixed
   * heights, and the slack fell below the last thing on the page instead of going into the chart.
   *
   * The charts now take the slack instead. Their wrappers are `flex-1`, so the leftover space
   * lands on the chart and the closing row — the fitness/fatigue/form trio, the day labels —
   * sits on the bottom edge of the cell, level with the Today pane's own last row. All three
   * tabs then end on the same line, and the dead air becomes plotting area.
   *
   * ## Why the sparkline's size is a constant and not a measurement
   *
   * It was measured, with `bind:clientWidth` / `bind:clientHeight` feeding `Sparkline`'s
   * `width`/`height`. In a box whose height comes from `flex-1`, that is a feedback loop: the
   * box asks for slack, the SVG is drawn at the slack's height, the SVG's intrinsic size
   * becomes part of what the box wants, and the card grows again on every rerender — measured
   * in the field at 1148px for a 900px screen, still climbing. The gain depends on which pane
   * is tallest and on when the measurement lands relative to layout, which is why it looked
   * random and why the fixture rides (which carry power, and take a different path) never
   * caught it.
   *
   * So the loop is cut rather than damped: a constant viewBox, `fill` to stretch into whatever
   * space the parent grants, and no measurement feeding back into layout. The chart still
   * absorbs the slack — it simply no longer claims any height of its own. The Load bars keep
   * their measured height because they are absolutely positioned: they read the box, they
   * cannot contribute to it.
   */
  const FORM_CHART_W = 352;
  const FORM_CHART_H = 100;
  let loadChartH = $state(112);
  const ringDash = $derived(ringFrac * GAUGE_ARC);
  // Gated on the same signal as the values above: "+0 pts / 7d" is as much of a claim as
  // "BALANCED", and both are false for a rider who has not ridden. No band change and no
  // empty window — just the absence of one of the two facts.
  const taperDelta = $derived(
    hasLoad && tsbSpark.length >= 8 ? Math.round(tsbSpark.at(-1)! - tsbSpark.at(-8)!) : null
  );
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
          if (!isCyclingActivity(a)) return false;
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
    <EditorialHeader greeting="Today" sub="Ready to build your goals today?" />
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
                  class="flex items-center gap-1 rounded-pill px-2.5 py-1 text-[10.5px] font-bold tracking-[0.04em] transition-colors {heroTab === t.id
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
            <span class="text-[10px] font-extrabold tracking-[0.14em] text-on-mono/50">LIVE</span>
          </div>
        </div>
      {/snippet}
      <!-- Grid-stack: all three panes share one grid cell → card height stays constant across tabs -->
      <div id="hero-pane" role="tabpanel" aria-labelledby="hero-tab-{heroTab}" class="grid">
      <div class="col-start-1 row-start-1 transition-opacity duration-150 ease-out h-full flex flex-col" class:opacity-0={heroTab !== 'today'} inert={heroTab !== 'today'}>
      <!--
        Tier 1: the gauge, with the band's name inside its opening.

        V3 (§42): the ring grows from 112px to 150px, and the band moves into the 240° sweep's
        open mouth — the one place on this card that is both part of the gauge and empty.
        §43 then scales the whole cluster up again, because 9.5px type inside a 180px ring read
        as a whisper: ring 150 → 180, figure 29 → 42, band name 9.5 → 12.

        The name could never live inside the 112px ring: "RECOVER FIRST" needs about 70px and
        the inner chord where a second line fell was about 56px, which is why it was pushed out
        to a full-width pill and had to invent a row to belong to. At 180px the clear span
        between the arc's two round caps is 118px, measured in the DOM at every width the hero
        has to survive. "RECOVER FIRST" is 103px in the 12px / .06em this label uses, so even
        the longest band name clears both caps with 7px a side.

        The label sits at the caps' own depth (R/2 below the centre), which is the widest point
        of the mouth — set it deeper and the ring's silhouette closes back in over it.

        The svg's box is 180px tall but the paint stops at `ARC_BOTTOM` (133.5), so 46.5px of
        empty box hangs under the arc and reads as a hole between the gauge and the pair
        below it. The wrapper carries a negative bottom margin of exactly that dead span, so
        the layout follows the *painted* arc — the pair sits 24px under the paint, not 70px
        under the box. The overlay children are absolute against the wrapper's own 180px box,
        so the figure and band positioning is untouched.
      -->
      <div class="flex justify-center pt-1">
        <div class="relative" style="margin-bottom:-{GAUGE_BOX - ARC_BOTTOM}px">
          <svg
            width={GAUGE_BOX}
            height={GAUGE_BOX}
            viewBox="0 0 {GAUGE_BOX} {GAUGE_BOX}"
            role="img"
            aria-label="Form TSB on a plus or minus 40 scale, 0 at the top"
          >
            <defs>
              <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#ff4d5e" />
                <stop offset="100%" stop-color="#e8102e" />
              </linearGradient>
            </defs>
            <circle
              cx={GAUGE_C}
              cy={GAUGE_C}
              r={R}
              fill="none"
              stroke="#23252c"
              stroke-width={STROKE}
              stroke-linecap="round"
              stroke-dasharray="{GAUGE_ARC} {CIRC}"
              transform="rotate({GAUGE_START} {GAUGE_C} {GAUGE_C})"
            />
            <!--
              `stroke-linecap="round"` still paints a dot for a zero-length dash, so the value
              arc is skipped outright when there is no form value to show. Without this the
              gauge reads "a tiny bit of form" when the honest answer is "none yet".
            -->
            {#if ringFrac > 0}
              <circle
                cx={GAUGE_C}
                cy={GAUGE_C}
                r={R}
                fill="none"
                stroke="url(#ringGrad)"
                stroke-width={STROKE}
                stroke-linecap="round"
                stroke-dasharray="{ringDash} {CIRC}"
                transform="rotate({GAUGE_START} {GAUGE_C} {GAUGE_C})"
                style="filter: drop-shadow(0 2px 8px rgba(232, 16, 46, 0.55));"
              />
            {/if}
            <!-- TSB 0 — the midpoint of the ±40 scale, the only mark that gives the arc meaning -->
            <line
              x1={GAUGE_C}
              y1={GAUGE_C - (R - STROKE / 2)}
              x2={GAUGE_C}
              y2={GAUGE_C - (R + STROKE / 2)}
              stroke="#f7f8fa"
              stroke-opacity="0.32"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
          <!--
            The figure rides the arc's mass, not the box: the painted shape stops at the two
            caps below the axis, so its centre is `ARC_RISE` above the box's. Centred on the box
            the number sits low inside its own ring.
          -->
          <div class="absolute inset-0 grid place-items-center">
            <div class="text-center" style="transform:translateY(-{ARC_RISE}px)">
              <p class="text-[42px] leading-none font-extrabold text-on-mono text-tabular">
                {tsbVal === null ? '—' : (tsbVal > 0 ? '+' : '') + tsbVal}
              </p>
              <p class="text-[10.5px] font-bold uppercase tracking-wider text-on-mono-dim mt-2">Form TSB</p>
            </div>
          </div>
          <!--
            The band name, on the card's vertical axis and at the caps' depth. `top` is derived
            from the ring's own radius — R/2 below the centre is exactly where the round caps
            sit — so it follows the gauge instead of a typed offset that could drift from it.
          -->
          <div
            class="absolute text-center"
            style="top:{GAUGE_C + R / 2}px;left:50%;transform:translate(-50%,-50%)"
          >
            <p
              class="text-[12px] font-extrabold uppercase leading-none tracking-[0.06em] whitespace-nowrap"
              style="color:{formTone}"
            >
              {formLabel}
            </p>
          </div>
        </div>
      </div>
      <!--
        Whatever height is left over goes here, so the load pair lands on the card's bottom edge
        the way the Form and Load panes' closing rows do.
      -->
      <div class="flex-1 min-h-0" aria-hidden="true"></div>      <!--
        Tier 2: the two load tiles, side by side under the ring (§45, "Tile Cerita").

        The bare pair under a hairline gave two numbers and no way to read them: 22 and 33 only
        mean something to a rider who already knows what CTL usually runs. Each figure now sits
        in an inset tile — mono2 on the mono card, the same hairline the Form pane's rows use —
        with a 4px bar under it placing the value on the shared 0–60 scale the caption names.
        The hairlines above and between the cells are gone with the bare pair: the tiles draw
        their own edges.

        Bars stay neutral on-mono even when the band is rose: the gauge arc owns the card's one
        accent moment, and CTL/ATL carry no band of their own to be tinted by. Figures are 26px
        against the gauge's 42 — the second tier of the pyramid (42 gauge, 26 pair, 18 trio),
        small enough that the bar and caption fit without pushing the card past the height the
        Form and Load panes have to match.

        Static classes only: a dynamic `mt-{gap}` never reaches Tailwind's scanner, so such a
        class would not exist and the lines would close up.
      -->
      <div class="mt-5 grid grid-cols-2 gap-2 shrink-0">
        {#each HERO_LOAD_TILES as t (t.label)}
          <div class="rounded-[14px] border border-[#2b2d33] bg-[#1b1c22] px-2 py-3 text-center">
            <p class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">{t.label}</p>
            <p class="mt-1 text-[26px] leading-none font-extrabold text-tabular {t.tone}">{t.value}</p>
            <p class="mt-1 text-[10px] font-semibold tracking-wider text-on-mono-dim/70">{t.unit}</p>
            <div class="mx-auto mt-2.5 h-1 w-[76%] overflow-hidden rounded-pill bg-[#23252c]">
              <div class="h-full rounded-pill bg-[#f7f8fa]/85" style="width:{t.pct}%"></div>
            </div>
          </div>
        {/each}
      </div>
      <p class="mt-2 text-center text-[9px] font-semibold tracking-wide text-on-mono-dim/55">
        Bar = position on a 0–60 scale
      </p>
      </div>
      <div class="col-start-1 row-start-1 transition-opacity duration-150 ease-out" class:opacity-0={heroTab !== 'form'} inert={heroTab !== 'form'}>
      <!--
        The pane fills the grid cell and the chart takes whatever height is left over, so the
        closing trio lands on the bottom edge instead of floating above a band of dead air.
        See the pane-height note beside `formChartH`.
      -->
      <div class="flex flex-col gap-1 h-full">
        <div class="flex items-baseline justify-between">
          <span class="text-[10.5px] font-bold uppercase tracking-wider text-on-mono-dim">Form · last 30 days</span>
          {#if taperDelta !== null}
            <span class="text-[12px] font-bold text-tabular text-rose">{taperDelta >= 0 ? '+' : ''}{taperDelta} pts / 7d</span>
          {/if}
        </div>
        <div class="-mx-1 flex-1 min-h-0">
          <Sparkline points={tsbSpark} width={FORM_CHART_W} height={FORM_CHART_H} fill showBaseline onDark ariaLabel="Form TSB last 30 days" />
        </div>
        <div class="pt-4 border-t border-[#2b2d33] grid grid-cols-3 text-center shrink-0">
          <div>
            <p class="text-[10.5px] font-bold uppercase tracking-wider text-on-mono-dim">Fitness</p>
            <p class="text-[18px] font-extrabold text-on-mono text-tabular mt-0.5">CTL {ctlVal ?? '—'}</p>
          </div>
          <div class="border-x border-[#2b2d33]">
            <p class="text-[10.5px] font-bold uppercase tracking-wider text-on-mono-dim">Fatigue</p>
            <p class="text-[18px] font-extrabold text-on-mono text-tabular mt-0.5">ATL {atlVal ?? '—'}</p>
          </div>
          <div>
            <p class="text-[10.5px] font-bold uppercase tracking-wider text-on-mono-dim">Form</p>
            <p class="text-[18px] font-extrabold text-rose text-tabular mt-0.5">
              {tsbVal === null ? '—' : (tsbVal > 0 ? '+' : '') + tsbVal} TSB
            </p>
          </div>
        </div>
      </div>
      </div>
      <div class="col-start-1 row-start-1 transition-opacity duration-150 ease-out" class:opacity-0={heroTab !== 'load'} inert={heroTab !== 'load'}>
      <!--
        Same treatment as the Form pane: this pane had the most dead air of the three, 59px under
        the day labels, because the bars were pinned to 112px while the cell was 191.5px tall.
        The bars now grow into it, and the day labels finish on the same line as the Today pane.
      -->
      <div class="flex flex-col gap-1 h-full">
        <div class="flex items-baseline justify-between">
          <span class="text-[10.5px] font-bold uppercase tracking-wider text-on-mono-dim">Daily load · last 7 days</span>
          <!--
            ~ marks a week whose load is partly modelled from speed/elevation: the sum is
            still the right planning number, but it is not all measured power.
          -->
          <span
            class="text-[12px] font-bold text-tabular text-on-mono"
            title={week.tssEstimated ? 'Includes rides scored from speed & elevation — no power data' : undefined}
          >
            {week.tssEstimated ? `~${week.tss}` : week.tss} TSS / wk
          </span>
        </div>
        <div class="flex-1 min-h-0" bind:clientHeight={loadChartH}>
          <TssBars days={week.dailyTss} target={tssTarget} height={loadChartH} onDark />
        </div>
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

    <!--
      Every number on this page — CTL, ATL, TSB, CP, W', the weekly TSS — is computed from
      the rides in the database. On a fresh install that database holds the seeder's demo
      rides, so a rider opening the app sees a complete, confident-looking training
      history that is entirely synthetic. Each ride now carries a DEMO badge, but that is
      per-row; the aggregates read as measurements.

      This chip appears only when **every** activity is synthetic. The `every` is the whole
      point: as soon as one real ride is imported, the chip disappears, because a partly
      real history must not carry a blanket "this is fake" label that would understate the
      numbers that really are measured.
    -->
    {#if allDemo}
      <div class="flex items-center gap-2 px-1">
        <StatusChip label="Demo data" status="neutral" />
        <p class="text-[11px] text-ink-dim leading-snug">
          Every figure here is computed from the bundled sample rides, not your training.
        </p>
      </div>
    {/if}

    <!-- LAST 7 DAYS -->
    <SectionCard kicker="Last 7 days">
      <div class="flex flex-col gap-5">
        <StatTrio
          items={[
            { label: 'Rides', value: String(ridesThisWeek) },
            { label: 'Distance', value: fmtDist(week.km, 0) },
            { label: 'Stress', value: week.tssEstimated ? `~${week.tss}` : `${week.tss}` }
          ]}
        />
        <TssBars days={week.dailyTss} target={tssTarget} />
        {#if week.tssEstimated}
          <p class="text-[10px] font-semibold uppercase tracking-wider text-ink-dim -mt-2">
            ~ rides scored from speed & elevation — no power data
          </p>
        {/if}
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
                  <Icon name="wrench" size={19} strokeWidth={1.5} />
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
                    <Icon name="calendar" size={19} strokeWidth={1.5} />
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
                <Icon name="arrow-up-right" size={16} strokeWidth={1.5} />
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
                <Icon name="flag" size={19} strokeWidth={1.5} />
              </div>
              <div class="flex flex-col">
                <span class="text-sm font-bold text-ink tracking-tight">No race planned yet</span>
                <span class="text-[10px] font-extrabold uppercase tracking-wider text-crimson-deep">Import a route & set a plan →</span>
              </div>
            </div>
            <span class="grid h-8 w-8 place-items-center rounded-pill bg-mono text-on-mono">
              <Icon name="arrow-up-right" size={16} strokeWidth={1.5} />
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
