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
  import { convertDistance, distanceUnit, formatDistance, formatPowerPerWeight, formatWeight, splitValue, type UnitSystem } from '$lib/domain/units';
  
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
    return (allActivities.current ?? []).filter((a) => new Date(a.date) >= cutoff).length;
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
   * The two load tiles beside the form gauge.
   *
   * They were a single loose column — a label over a 28px number, then a hairline, then the
   * band name over the ATL figure — which left the right half of the hero reading as empty
   * because the content sat at the far left of a box twice as wide as it needed.
   *
   * The tiles borrow the shape used for the club-stat blocks elsewhere (label, then figure,
   * then unit, in a raised dark tile) so the hero matches the rest of the app's stat language.
   * `unit` is separated from `value` rather than concatenated into "CTL 23", because at 320px
   * the column is 108px wide and a single run-on string wraps.
   */
  const HERO_LOAD_TILES = $derived([
    {
      label: 'Fitness',
      value: ctlVal ?? '—',
      unit: 'CTL',
      icon: 'activity',
      tone: 'text-rose'
    },
    { label: 'Fatigue', value: atlVal ?? '—', unit: 'ATL', icon: 'zap', tone: 'text-on-mono' }
  ] as const);
  const ringFrac = $derived(
    tsbVal === null ? 0 : Math.max(0, Math.min(1, (tsbVal + FORM_SPAN) / (FORM_SPAN * 2)))
  );
  const R = 44;
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
  const STROKE = 10;
  const GAUGE_BOX = 112; // the svg's own width and height

  /**
   * The arc does not fill its 112px box, so the box's centre is not the ring's centre.
   *
   * The painted shape starts at the very top of the box — 49px above the axis, radius plus
   * half the stroke — and stops at the two round caps, which sit at 30° and 150°, where the
   * arc has fallen only 22px below the axis. So the mass spans 7..83 of the box and its centre
   * is 11px above the box's centre.
   *
   * Anything set beside the ring and aligned to the box therefore reads as sitting too low:
   * the rider sees the arc, not the box. `ARC_RISE` is that difference, and it is derived from
   * the geometry rather than typed, so it cannot drift away from the ring it describes.
   */
  const ARC_TOP = GAUGE_BOX / 2 - (R + STROKE / 2);
  const ARC_BOTTOM =
    GAUGE_BOX / 2 +
    (R * Math.sin(((GAUGE_START + GAUGE_SWEEP) % 360) * (Math.PI / 180)) + STROKE / 2);
  const ARC_RISE = GAUGE_BOX / 2 - (ARC_TOP + ARC_BOTTOM) / 2;

  /**
   * The cards ride on the arc's axis, not the box's, so everything below the arc's lowest point
   * is empty. The status row used to follow the 112px box and landed 46.5px under the cards,
   * with the ring continuing down the left of the gap. It now follows the cards instead, at a
   * fixed `STATUS_GAP` under them, which is the one distance the rider actually sees.
   *
   * `CARD_H` is the card's measured height: 73px of label, figure and unit. It is 72px at
   * 320px, so the gap moves by 1px at the narrowest width — well under the tolerance anything
   * here is judged by, and better than measuring it at runtime for a value that never varies.
   */
  const CARD_H = 73;
  const STATUS_GAP = 20;
  const STATUS_LIFT = GAUGE_BOX / 2 - ARC_RISE + CARD_H / 2 + STATUS_GAP - GAUGE_BOX;

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
   * The height is read back off the element with `bind:clientHeight` rather than hard-coded to
   * the measured 191.5px. It is derived from the tallest pane, which moves with the label
   * wrapping and the type scale; a constant would drift the first time any of those changed.
   * Width is bound for the same reason, and because `Sparkline` sizes itself from these two
   * numbers alone.
   */
  let formChartW = $state(352);
  let formChartH = $state(96);
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
      <div class="col-start-1 row-start-1 transition-opacity duration-150 ease-out h-full flex flex-col" class:opacity-0={heroTab !== 'today'} inert={heroTab !== 'today'}>
      <!--
        Tier 1 of three: what the rider is like right now.

        The gauge and the two load figures share one axis. `items-center`, not stretch — a
        stretched tile is not a tidier tile, it is a padded one. At 147px tall these held 72px of
        empty space between the label and the figure, and their bottom edge landed exactly on
        the divider below. Height follows content, so the tiles are as tall as they need to be.

        The axis they are centred on is the arc's, not the 112px box's: see `ARC_RISE`. Centre
        on the box and the pair reads 11px low against the circle, which is the ring looking
        taller than the cards rather than the two sitting crooked.

        `gap-3` and not `gap-5`: 20px of daylight between a 98px circle and a bordered card
        is a hole, not a separation, and the eye reads it as a third column that is missing.
      -->
      <div class="flex items-center gap-3">
        <div class="relative shrink-0">
          <svg width="112" height="112" viewBox="0 0 112 112" role="img" aria-label="Form TSB on a plus or minus 40 scale, 0 at the top">
            <defs>
              <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#ff4d5e" />
                <stop offset="100%" stop-color="#e8102e" />
              </linearGradient>
            </defs>
            <circle
              cx="56"
              cy="56"
              r={R}
              fill="none"
              stroke="#23252c"
              stroke-width="10"
              stroke-linecap="round"
              stroke-dasharray="{GAUGE_ARC} {CIRC}"
              transform="rotate({GAUGE_START} 56 56)"
            />
            <!--
              `stroke-linecap="round"` still paints a dot for a zero-length dash, so the value
              arc is skipped outright when there is no form value to show. Without this the
              gauge reads "a tiny bit of form" when the honest answer is "none yet".
            -->
            {#if ringFrac > 0}
              <circle
                cx="56"
                cy="56"
                r={R}
                fill="none"
                stroke="url(#ringGrad)"
                stroke-width="10"
                stroke-linecap="round"
                stroke-dasharray="{ringDash} {CIRC}"
                transform="rotate({GAUGE_START} 56 56)"
                style="filter: drop-shadow(0 2px 8px rgba(232, 16, 46, 0.55));"
              />
            {/if}
            <!-- TSB 0 — the midpoint of the ±40 scale, the only mark that gives the arc meaning -->
            <line
              x1="56"
              y1="17"
              x2="56"
              y2="7"
              stroke="#f7f8fa"
              stroke-opacity="0.32"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
          <div class="absolute inset-0 grid place-items-center">
            <div class="text-center">
              <p class="text-[26px] leading-none font-extrabold text-on-mono text-tabular">
                {tsbVal === null ? '—' : (tsbVal > 0 ? '+' : '') + tsbVal}
              </p>
              <p class="text-[9px] font-bold uppercase tracking-wider text-on-mono-dim mt-1.5">Form TSB</p>
            </div>
          </div>
        </div>
        <!--
          The two load figures, sized by their own content and centred on the gauge.

          Inside a tile the three lines are one block on a fixed rhythm — label, figure, unit —
          rather than pushed to opposite ends. `justify-between` across a tall box is what opened
          a 72px hole between the label and the figure; a fixed rhythm reads as one object.
        -->
        <div
          class="min-w-0 flex-1 grid grid-cols-2 gap-2"
          style="transform:translateY(-{ARC_RISE}px)"
        >
          {#each HERO_LOAD_TILES as t (t.label)}
            <div class="rounded-xl border border-[#2b2d33] bg-[#23252c]/60 px-1.5 py-2 text-center">
              <!--
                At 320px a tile is 50px wide, leaving 36px of content — and "FITNESS" alone
                measures 39px there. So below 360px the icon goes and the label drops to 8px
                with the letter-spacing off; at 360px the tile is 70px and everything fits
                again. Truncating the label instead would have left the rider reading "Fitne…".
              -->
              <p class="flex items-center justify-center gap-1 text-[8px] font-bold uppercase tracking-normal text-on-mono-dim min-[360px]:text-[9px] min-[360px]:tracking-wider">
                <Icon name={t.icon} size={11} strokeWidth={2} class="hidden shrink-0 min-[360px]:block" />
                <span class="truncate">{t.label}</span>
              </p>
              <p class="mt-1 text-[20px] font-extrabold text-tabular leading-none {t.tone}">
                {t.value}
              </p>
              <p class="mt-1 text-[9px] font-semibold tracking-wider text-on-mono-dim/70">
                {t.unit}
              </p>
            </div>
          {/each}
        </div>
      </div>
      <!--
        Tier 2: how that state is moving.

        The band cannot live inside the gauge — "RECOVER FIRST" needs about 70px and the ring's
        inner chord is about 60px where a second line falls, confirmed by three separate
        measurements. Nor can it sit under the gauge, which is where it was rejected twice: a
        lone coloured line with nothing beside it has no column to belong to. So it becomes a
        status line in its own right, spanning the card, with the week's change opposite it.

        The line itself sits below that row, not above it. A rule drawn over a caption hangs
        the caption from the rule; the same rule under it closes the block and lets the week's
        numbers start cleanly on the other side. The row is measured off the cards, not off the
        ring's box, so the ring cannot open a hole under them — see `STATUS_LIFT`.

        The band is a pill in the same register as the two cards beside it: the same neutral
        border, the same faint fill. The colour goes on the name inside it, not on the chip, so
        the three figures in the card share one palette and only the band name is highlighted.

        The pill is as wide as the rule under it, edge to edge. Sized to its own text it was a
        narrow chip floating in a wide card, and the two things the rider is meant to read
        across — the band and the week's change — sat in the middle of a lot of nothing. The
        rule below is already exactly this wide, so the pill takes its measure from that rather
        than from its contents, and the two lines stack as one block.

        The week's change sits inside the pill rather than beside it. Two objects on one line
        meant the row had two ends and the eye was pulled to both margins of the card at once
        with the middle left empty. One pill on the card's axis has one centre.

        That also gives the card a three-tier hierarchy instead of two unrelated strips:
          1. what I am like now    → gauge + fitness + fatigue
          2. how that is moving    → band + 7-day change
          3. what I did this week  → time + distance + stress
      -->
      <!--
        One pill, not two objects. The band's name and the week's change are the same statement
        — what the form is, and where it went — so they are one chip with a hairline between
        them, the same hairline the week's trio uses between its own cells.
      -->
      <div class="flex" style="margin-top:{STATUS_LIFT}px">
        <span
          class="flex w-full items-center justify-center gap-2 rounded-pill border border-[#2b2d33] bg-[#23252c]/60 px-4 py-[5px]"
        >
          <span
            class="text-[10px] font-extrabold uppercase leading-none tracking-[0.12em]"
            style="color:{formTone}"
          >
            {formLabel}
          </span>
          {#if taperDelta !== null}
            <span class="h-3 w-px bg-[#2b2d33]" aria-hidden="true"></span>
            <span class="text-[11px] font-bold leading-none text-tabular text-on-mono-dim">
              {taperDelta >= 0 ? '+' : ''}{taperDelta} pts / 7d
            </span>
          {/if}
        </span>
      </div>
      <!--
        The pane fills the cell and this spacer absorbs whatever is left over, so the trio lands
        on the bottom edge. Without it this pane was only correct while it happened to be the
        tallest of the three: the Form and Load panes take their height from the cell, so as soon
        as either grew past the Today pane's own content the card got taller and the Today trio
        was left floating a few pixels above the bottom edge, with the other two tabs' last rows
        on the line below it. The spacer costs nothing when there is no slack, so the spacing
        `mt-3` still sets is untouched.
      -->
      <div class="flex-1 min-h-0" aria-hidden="true"></div>
      <div class="mt-3 pt-3 border-t border-[#2b2d33] grid grid-cols-3 text-center shrink-0">
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
      <!--
        The pane fills the grid cell and the chart takes whatever height is left over, so the
        closing trio lands on the bottom edge instead of floating above a band of dead air.
        See the pane-height note beside `formChartH`.
      -->
      <div class="flex flex-col gap-1 h-full">
        <div class="flex items-baseline justify-between">
          <span class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">Form · last 30 days</span>
          {#if taperDelta !== null}
            <span class="text-[11px] font-bold text-tabular text-rose">{taperDelta >= 0 ? '+' : ''}{taperDelta} pts / 7d</span>
          {/if}
        </div>
        <div
          class="-mx-1 flex-1 min-h-0"
          bind:clientWidth={formChartW}
          bind:clientHeight={formChartH}
        >
          <Sparkline points={tsbSpark} width={formChartW} height={formChartH} showBaseline onDark ariaLabel="Form TSB last 30 days" />
        </div>
        <div class="pt-4 border-t border-[#2b2d33] grid grid-cols-3 text-center shrink-0">
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
      <!--
        Same treatment as the Form pane: this pane had the most dead air of the three, 59px under
        the day labels, because the bars were pinned to 112px while the cell was 191.5px tall.
        The bars now grow into it, and the day labels finish on the same line as the Today pane.
      -->
      <div class="flex flex-col gap-1 h-full">
        <div class="flex items-baseline justify-between">
          <span class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">Daily load · last 7 days</span>
          <span class="text-[11px] font-bold text-tabular text-on-mono">{week.tss} TSS / wk</span>
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
