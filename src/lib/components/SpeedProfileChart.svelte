<!--
  Interactive route profile — UI-SPEC §4.6 zone 4, §21 and §23.

  Both series come from `planSeries(plan)`, i.e. from the physics solution: the altitude
  area is the real terrain and the speed line is the *solved* speed per segment, so the
  descent really does run faster than the climb. Nothing here is normalised for looks.

  uPlot draws the canvas; the crosshair tooltip is plain DOM so it can use the app's
  design tokens (a canvas-drawn tooltip cannot).

  Reused by the live race cockpit (§23) with three optional extras:
    · `markers`     — cut-off gates drawn as vertical lines with a flag label
    · `positionKm`  — the rider's current position (solid line + dot)
    · `tooltip`     — a snippet replacing the default readout, so the cockpit can show
                      buffer and feasibility instead of just terrain
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { X } from '@lucide/svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { clockOf, durationOf, type PlanSeriesPoint } from '$lib/domain/pacing';

  export interface ChartMarker {
    km: number;
    label: string;
    /** draw the marker in status colour instead of neutral ink */
    tone?: 'neutral' | 'aman' | 'waspada' | 'kritis';
  }

  let {
    points,
    height = 190,
    /** powers shown on the wall markers, so the warning can name a number */
    targetWatts = 0,
    markers = [],
    /** current rider position in km, or null when there is nothing to mark */
    positionKm = null,
    /** replaces the default tooltip readout; receives the hovered row */
    tooltip,
    /** fired whenever the crosshair moves, with null when it leaves the plot */
    onhover = null
  }: {
    points: PlanSeriesPoint[];
    height?: number;
    targetWatts?: number;
    markers?: ChartMarker[];
    positionKm?: number | null;
    tooltip?: Snippet<[PlanSeriesPoint]>;
    onhover?: ((p: PlanSeriesPoint | null) => void) | null;
  } = $props();

  const C = {
    alt: '#e8102e',
    speed: '#141519',
    wall: '#c8102e',
    grid: '#e8eaed',
    axis: '#9ba1aa',
    tick: '#62656c',
    ink: '#17181c',
    marker: '#62656c',
    aman: '#0a7450',
    waspada: '#b8620a'
  };

  const TONE: Record<string, string> = {
    neutral: C.marker,
    aman: C.aman,
    waspada: C.waspada,
    kritis: C.wall
  };

  let hostWidth = $state(0);
  /** index into `points` under the crosshair, plus its canvas x position */
  let hover = $state<{ i: number; x: number } | null>(null);
  /**
   * A pinned point. Hover alone loses the readout the moment the pointer leaves the plot,
   * which is useless when the rider wants to *read* a value; a click/tap parks it here
   * until it is clicked again, cleared with Escape, or dismissed with the ✕.
   */
  let pinned = $state<{ i: number; x: number } | null>(null);

  const hasWalls = $derived(points.some((p) => p.powerLimited));
  /** the readout follows the pin while one is set, otherwise the crosshair */
  const active = $derived(pinned ?? hover);
  // guard the index: a re-solved plan can be shorter than the one the pin was set on
  const h = $derived(active && active.i < points.length ? points[active.i] : null);

  function pinAt(i: number, x: number): void {
    if (i < 0 || i >= points.length) return;
    pinned = pinned && pinned.i === i ? null : { i, x };
    onhover?.(pinned ? points[pinned.i] : null);
  }

  function clearPin(): void {
    if (!pinned) return;
    pinned = null;
    onhover?.(null);
  }

  function nudgePin(step: number): void {
    if (!pinned) return;
    const next = Math.min(points.length - 1, Math.max(0, pinned.i + step));
    if (next === pinned.i) return;
    pinAt(next, pinned.x);
  }

  function fillGradient(u: uPlot, _si: number): CanvasGradient {
    const grd = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
    grd.addColorStop(0, 'rgba(232,16,46,0.42)');
    grd.addColorStop(0.6, 'rgba(232,16,46,0.14)');
    grd.addColorStop(1, 'rgba(232,16,46,0)');
    return grd;
  }

  /** Cut-off gates, the rider's position and the pin, painted after the series. */
  function drawOverlay(u: uPlot, pts: PlanSeriesPoint[]): void {
    const pinRow = pinned ? pts[pinned.i] : null;
    const { ctx, bbox } = u;
    if (bbox.width <= 0) return;
    ctx.save();

    for (const m of markers) {
      const x = u.valToPos(m.km, 'x', true);
      if (!Number.isFinite(x) || x < bbox.left - 1 || x > bbox.left + bbox.width + 1) continue;
      ctx.strokeStyle = TONE[m.tone ?? 'neutral'] ?? C.marker;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, bbox.top);
      ctx.lineTo(x, bbox.top + bbox.height);
      ctx.stroke();
      ctx.setLineDash([]);

      // pill behind the label so it stays readable over the altitude fill and never
      // collides with the right-hand speed scale
      ctx.font = '700 9px "Plus Jakarta Sans", system-ui, sans-serif';
      const tw = ctx.measureText(m.label).width;
      const flip = x + tw + 10 > bbox.left + bbox.width;
      const lx = flip ? x - 4 - tw : x + 4;
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.fillRect(lx - 2, bbox.top + 1, tw + 4, 12);
      ctx.fillStyle = TONE[m.tone ?? 'neutral'] ?? C.marker;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(m.label, lx, bbox.top + 2);
    }

    if (positionKm != null) {
      const x = u.valToPos(positionKm, 'x', true);
      if (Number.isFinite(x)) {
        ctx.strokeStyle = C.alt;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, bbox.top);
        ctx.lineTo(x, bbox.top + bbox.height);
        ctx.stroke();

        // dot on the speed line, so the position reads as a place on the route and not
        // just a rule across the chart
        const row = nearestByKm(pts, positionKm);
        if (row) {
          const y = u.valToPos(row.kph, 'y1', true);
          ctx.fillStyle = C.alt;
          ctx.beginPath();
          ctx.arc(x, y, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    // the pinned point is drawn LAST so it is never hidden by the position line
    if (pinRow) {
      const x = u.valToPos(pinRow.km, 'x', true);
      if (Number.isFinite(x)) {
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x, bbox.top);
        ctx.lineTo(x, bbox.top + bbox.height);
        ctx.stroke();

        // hollow ring on the speed series = "looking at this", which reads differently
        // from the filled dot used for the live position
        const y = u.valToPos(pinRow.kph, 'y1', true);
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // small triangle flag at the top so the pin is findable at a glance
        ctx.fillStyle = C.ink;
        ctx.beginPath();
        ctx.moveTo(x - 4, bbox.top + 16);
        ctx.lineTo(x + 4, bbox.top + 16);
        ctx.lineTo(x, bbox.top + 23);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function nearestByKm(pts: PlanSeriesPoint[], km: number): PlanSeriesPoint | null {
    if (pts.length === 0) return null;
    let best = pts[0];
    for (const p of pts) {
      if (Math.abs(p.km - km) < Math.abs(best.km - km)) best = p;
    }
    return best;
  }

  function buildOptions(width: number, pts: PlanSeriesPoint[]): uPlot.Options {
    return {
      width,
      height,
      legend: { show: false },
      cursor: {
        // x-only drag: touch and mouse both scrub without scaling the axes
        drag: { x: true, y: false, setScale: false, dist: 4 },
        // snap to the nearest solved point so the tooltip is never between segments
        focus: { prox: -1 },
        points: { show: true, size: 7, width: 2, stroke: C.speed }
      },
      scales: {
        x: { time: false },
        y: { auto: true },
        y1: { auto: true, range: (_u, _min, max) => [0, Math.max(max * 1.12, 5)] }
      },
      axes: [
        {
          stroke: C.axis,
          grid: { show: false },
          ticks: { show: false },
          font: '10px "Plus Jakarta Sans", system-ui, sans-serif',
          size: 22,
          gap: 6,
          show: true,
          values: (_u, vals) => vals.map((v) => (v >= 10 ? `${Math.round(v)}` : v.toFixed(0)))
        },
        {
          stroke: C.axis,
          grid: { stroke: C.grid, width: 1 },
          ticks: { show: false },
          font: '10px "Plus Jakarta Sans", system-ui, sans-serif',
          size: 30,
          show: true,
          values: (_u, vals) => vals.map((v) => `${Math.round(v)}`)
        },
        {
          // side 1 puts the speed scale on the right; without it uPlot draws it on top
          // of the altitude labels and the two scales read as one broken number
          side: 1,
          stroke: C.axis,
          grid: { show: false },
          ticks: { show: false },
          font: '10px "Plus Jakarta Sans", system-ui, sans-serif',
          size: 26,
          show: true,
          values: (_u, vals) => vals.map((v) => `${Math.round(v)}`)
        }
      ],
      series: [
        {},
        {
          label: 'Altitude',
          scale: 'y',
          stroke: C.alt,
          width: 2.5,
          fill: fillGradient,
          points: { show: false }
        },
        {
          label: 'Speed',
          scale: 'y1',
          stroke: C.speed,
          width: 1.5,
          dash: [4, 3],
          points: { show: false }
        },
        {
          label: 'Beyond target',
          scale: 'y1',
          stroke: C.wall,
          width: 0,
          paths: () => null,
          points: { show: true, size: 4, fill: C.wall, stroke: C.wall }
        }
      ],
      hooks: {
        draw: [
          (u) => {
            drawOverlay(u, pts);
          }
        ],
        setCursor: [
          (u) => {
            const i = u.cursor.idx;
            if (i == null || i < 0 || i >= pts.length) {
              hover = null;
              // while a pin is set the crosshair leaving the plot must not clear the
              // readout — that is the whole point of pinning it
              if (!pinned) onhover?.(null);
              return;
            }
            const x = u.valToPos(u.data[0][i], 'x');
            hover = { i, x };
            if (!pinned) onhover?.(pts[i]);
          }
        ]
      }
    };
  }

  let host: HTMLDivElement | undefined = $state();
  /** live uPlot instance, so the pin can trigger a repaint without recreating the chart */
  let plotRef: uPlot | null = null;
  $effect(() => {
    const el = host;
    if (!el || hostWidth < 80 || points.length < 2) return;
    // a few pixels of breathing room so the right-hand speed scale is never clipped
    const width = Math.max(80, hostWidth - 10);
    // uPlot must never be handed a Svelte reactive proxy, and its auto-range must not be
    // computed while the container is still being laid out — doing so leaves scales.x
    // unset, collapses every series to a single point (idxs [0,0]) and renders a blank
    // chart while the DOM still looks healthy. Build the data now, construct next frame.
    const plain: PlanSeriesPoint[] = points.map((p) => ({ ...p }));
    const data: uPlot.AlignedData = [
      plain.map((p) => p.km),
      plain.map((p) => p.altM),
      plain.map((p) => p.kph),
      // nulls break the path, so only the wall segments get a dot
      plain.map((p) => (p.powerLimited ? p.kph : null))
    ];

    const frame = requestAnimationFrame(() => {
      const plot = new uPlot(buildOptions(width, plain), data, el);
      plotRef = plot;

      // Click/tap pins the readout. The listener is registered in the CAPTURE phase on the
      // host, because uPlot's own wrap-level click handler runs `stopImmediatePropagation`
      // whenever it thinks a drag happened — a later click would otherwise be swallowed.
      const onClick = (e: MouseEvent): void => {
        if (e.target !== plot.over) return;
        const rect = plot.over.getBoundingClientRect();
        // Read the *value* under the pointer, then find the nearest solved row ourselves.
        // posToIdx would do this internally, but it returns an index into uPlot's own data
        // array, which is only the same array when nothing has been decimated since.
        const km = plot.posToVal(e.clientX - rect.left, 'x');
        if (!Number.isFinite(km)) return;
        let i = 0;
        let best = Infinity;
        for (let k = 0; k < plain.length; k++) {
          const d = Math.abs(plain[k].km - km);
          if (d < best) {
            best = d;
            i = k;
          }
        }
        pinAt(i, plot.valToPos(plain[i].km, 'x'));
      };
      el.addEventListener('click', onClick, true);

      const ro = new ResizeObserver(() => {
        const w = Math.max(80, el.clientWidth - 10);
        if (w > 80 && Math.abs(w - plot.width) > 1) {
          plot.setSize({ width: w, height });
          if (pinned) pinned = { ...pinned };
        }
      });
      ro.observe(el);

      cleanup = () => {
        ro.disconnect();
        el.removeEventListener('click', onClick, true);
        if (plotRef === plot) plotRef = null;
        plot.destroy();
      };
    });

    let cleanup: (() => void) | null = null;
    return () => {
      cancelAnimationFrame(frame);
      cleanup?.();
    };
  });

  // The pin lives on the canvas, so it needs an explicit repaint when it moves.
  $effect(() => {
    void pinned;
    plotRef?.redraw();
  });

  // Canvas charts are unreachable by keyboard unless the host takes focus, so the pin is
  // also driveable with arrows / Home / End / Escape.
  function onKeydown(e: KeyboardEvent): void {
    const big = Math.max(1, Math.round(points.length / 10));
    if (e.key === 'Escape') {
      clearPin();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (!pinned) {
        // first arrow press pins the current crosshair, then starts stepping
        const start = hover?.i ?? Math.floor(points.length / 2);
        pinAt(start, hover?.x ?? 0);
        return;
      }
      nudgePin((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? big : 1));
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const i = e.key === 'Home' ? 0 : points.length - 1;
      pinAt(i, hover?.x ?? 0);
    }
  }
</script>

<div class="flex flex-col gap-2">
  {#if points.length < 2}
    <div class="grid place-items-center rounded-2xl bg-tile border border-hairline" style="height:{height}px">
      <span class="text-[11px] font-bold uppercase tracking-wider text-ink-dim">No route profile yet</span>
    </div>
  {:else}
    <!--
      The readout lives in its own band ABOVE the canvas, not as a floating card inside it.
      A floating card has to sit somewhere over the plot: over the summit it hides the very
      climb the rider is asking about, and over a cut-off marker it hides the label. Here the
      band is always the same height, so the chart never reflows, and nothing is ever covered.
      The caret below it is the only thing that tracks the pointer.
    -->
    <div class="relative h-[62px]">
      {#if h && active}
        {@const tipLeft = Math.max(0, Math.min(hostWidth - 8, active.x))}
        <div
          class="absolute inset-x-2 top-0 rounded-2xl bg-mono border border-white/10 elevation-raised px-3 py-2 flex flex-col gap-0.5"
        >
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0 flex flex-col gap-0.5">
              {#if tooltip}
                {@render tooltip(h)}
              {:else}
                <span class="text-[10px] font-extrabold uppercase tracking-wider text-rose">
                  KM {h.km.toFixed(1)}
                </span>
                <span class="text-[11px] font-bold text-white tabular">
                  {h.gradePct >= 0 ? '+' : ''}{h.gradePct.toFixed(1)}% grade · {h.altM.toFixed(0)} m · {h.kph.toFixed(1)} km/h
                </span>
                <span class="text-[10px] font-semibold text-on-mono-dim tabular">
                  {durationOf(h.elapsedSec)} in · {clockOf(h.clockMin)}
                </span>
                {#if h.powerLimited}
                  <span class="text-[9px] font-extrabold uppercase tracking-wider text-rose">
                    Beyond {targetWatts} W
                  </span>
                {/if}
              {/if}
            </div>
            {#if pinned}
              <button
                class="pointer-events-auto shrink-0 grid h-5 w-5 place-items-center rounded-full bg-white/10 text-on-mono-dim hover:bg-white/20 hover:text-white transition-colors"
                onclick={clearPin}
                aria-label="Clear pinned point"
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            {/if}
          </div>
        </div>
        <!-- caret: ties the band to the point without covering it -->
        <span
          class="absolute bottom-0 h-2 w-2 rotate-45 bg-mono border-r border-b border-white/10 translate-x-1/2"
          style="left:{tipLeft}px"
          aria-hidden="true"
        ></span>
      {:else}
        <div class="absolute inset-x-2 top-0 grid place-items-center rounded-2xl border border-dashed border-hairline-strong h-full">
          <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">
            Hover or click the profile for details
          </span>
        </div>
      {/if}
    </div>

    <div
      class="relative select-none rounded-2xl focus-visible:outline-2 focus-visible:outline-signal focus-visible:outline-offset-2"
      bind:clientWidth={hostWidth}
      bind:this={host}
      role="slider"
      tabindex="0"
      aria-label="Inspect a point on the route profile — altitude and solved speed over distance"
      aria-valuemin={points[0].km}
      aria-valuemax={points[points.length - 1].km}
      aria-valuenow={h?.km ?? points[0].km}
      aria-valuetext={h
        ? `KM ${h.km.toFixed(1)}, ${h.gradePct >= 0 ? '+' : ''}${h.gradePct.toFixed(1)} percent grade, ${h.altM.toFixed(0)} metres, ${h.kph.toFixed(1)} km per hour`
        : undefined}
      onkeydown={onKeydown}
    >
    </div>

    <!-- legend: real series only, no decorative labels -->
    <div class="flex items-center gap-3 text-[9px] font-extrabold uppercase tracking-wider text-ink-dim">
      <span class="flex items-center gap-1">
        <span class="h-0.5 w-3 rounded-full" style="background:{C.alt}"></span>Altitude
      </span>
      <span class="flex items-center gap-1">
        <span class="h-0 w-3 border-t-2 border-dashed" style="border-color:{C.speed}"></span>Speed
      </span>
      {#if hasWalls}
        <span class="flex items-center gap-1 text-kritis">
          <span class="h-1.5 w-1.5 rounded-full" style="background:{C.wall}"></span>Beyond target
        </span>
      {/if}
      {#if markers.length > 0}
        <span class="flex items-center gap-1">
          <span class="h-3 w-px" style="background:{C.marker}"></span>Cut-off
        </span>
      {/if}
      {#if positionKm != null}
        <span class="flex items-center gap-1 text-crimson-deep">
          <span class="h-2 w-2 rounded-full" style="background:{C.alt}"></span>You
        </span>
      {/if}
      <span class="ml-auto normal-case tracking-normal font-medium">
        {#if pinned}
          <button class="underline decoration-dotted underline-offset-2 hover:text-ink" onclick={clearPin}>
            Clear pin
          </button>
        {:else}
          Drag, hover, or click to pin
        {/if}
      </span>
    </div>
  {/if}
</div>
