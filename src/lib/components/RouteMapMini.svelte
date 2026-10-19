<script lang="ts">
  /**
   * RouteMapMini — the live race's offline route map (UI-SPEC §4.8 companion).
   *
   * ## Why an inline SVG, not a map library
   *
   * A race runs offline with a saturated rider and a dying battery. MapLibre/Leaflet
   * would pull tile downloads, gesture libraries and a WebGL context into the one screen
   * whose job is to survive the day; the rider's question — "where am I on this course and
   * where is the km I just tapped?" — is answered by the track's own shape drawn to fit
   * the box. No tiles means no network, no cache policy, no map-attribution chore: the
   * route is the map. Every card in this app is this opinionated already.
   *
   * ## The two markers, and who owns which
   *
   * - **You** (`positionKm`): where the rider is, from the logged checkpoint or the plan
   *   projection — crimson dot, always drawn when the km is on the route.
   * - **Inspect** (`probeKm`): the elevation profile's crosshair, mirrored here. The race
   *   page taps the profile, passes the km in, and the map shows the same instant — two
   *   views of one position, never two sources of truth. Null when the cursor left the
   *   profile, so the pointer disappears with it.
   *
   * The projection is a plain equirectangular fit of the track to the card box, scaled
   * *uniformly* (the letterbox stays centered): stretching to fill would distort the
   * course's shape, and a bend the rider recognises is the whole point of drawing it.
   * Latitudes around Indonesia make the cos-lat distortion negligible at card scale.
   *
   * ## Tap to enlarge
   *
   * The card copy of the map is 128 px tall — enough to recognise the course, not enough
   * *read a gate label* mid-race. Tapping the card opens a full-screen dialog drawn from
   * the same projection with a larger box and doubled marker sizes, so "which km is that?"
   * is answerable without squinting. The fit is a pure function of box size, which is what
   * lets one SVG snippet render both; there is no second source of track truth. Closed by
   * the × button, Escape, and nothing else — a stray tap on the track must not dismiss the
   * view the rider just opened. Only the dialog is interactive; the card itself keeps its
   * role as a plain mirrored readout for anyone who never taps it.
   */

  import Icon from '$lib/components/Icon.svelte';

  interface TrackPoint {
    km: number;
    lat: number;
    lng: number;
  }

  interface MarkerKm {
    km: number;
    label?: string;
  }

  let {
    points,
    positionKm = null,
    probeKm = null,
    markers = [],
    height = 132
  }: {
    points: TrackPoint[];
    /** rider's km — crimson "you" marker */
    positionKm?: number | null;
    /** elevation-probe km — the mirrored inspect pointer */
    probeKm?: number | null;
    /** checkpoint (and finish) km to tick on the track, optionally named */
    markers?: MarkerKm[];
    height?: number;
  } = $props();

  const W = 320; // internal viewBox width of the card copy
  const H = 100;
  /**
   * Full-screen box. Sits between a portrait phone (≈0.46) and a landscape desktop
   * window (≈1.8) so the track is width-bound on a phone — near the full screen width —
   * and still grows on a big window instead of being clamped by a tall viewBox.
   */
  const BIG_W = 360;
  const BIG_H = 560;

  let expanded = $state(false);
  let dialogEl: HTMLDivElement | undefined = $state();

  /** A track fitted into one box: same projection, different viewport. */
  interface Fit {
    w: number;
    h: number;
    toXY(p: TrackPoint): { x: number; y: number };
    path: string;
    span: number;
  }

  /** Uniformly-scaled equirectangular track fit for one box — pure in `points`. */
  function fitBox(boxW: number, boxH: number, pad: number): Fit | null {
    if (points.length < 2) return null;
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    // metres-per-degree style scale: multiply longitude by cos(mean lat) so an east-west
    // route is not drawn stretched compared with a north-south one
    const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const dx = (maxLng - minLng) * kx || 1e-6;
    const dy = maxLat - minLat || 1e-6;
    // uniform scale + centering (the letterbox is the compromise that keeps shape true)
    const s = Math.min((boxW - pad * 2) / dx, (boxH - pad * 2) / dy);
    const ox = (boxW - dx * s) / 2;
    const oy = (boxH - dy * s) / 2;
    const toXY = (p: TrackPoint) => ({
      x: ox + (p.lng - minLng) * kx * s,
      y: oy + (maxLat - p.lat) * s
    });
    const path = points
      .map(toXY)
      .map((xy, i) => `${i === 0 ? 'M' : 'L'}${xy.x.toFixed(1)} ${xy.y.toFixed(1)}`)
      .join(' ');
    return { w: boxW, h: boxH, toXY, path, span: points[points.length - 1]!.km - points[0]!.km || 1e-6 };
  }

  const shape = $derived(fitBox(W, H, 12));
  // the expanded box only exists while the dialog is open — no projection work for a
  // view nobody asked for
  const bigShape = $derived(expanded ? fitBox(BIG_W, BIG_H, 26) : null);

  /** km → point on the stored track (linear scan: ≤ ~600 points, called per render) */
  function atKm(km: number): TrackPoint | null {
    if (!points.length) return null;
    if (km <= points[0]!.km) return points[0]!;
    const last = points[points.length - 1]!;
    if (km >= last.km) return last;
    for (let i = 1; i < points.length; i++) {
      if (points[i]!.km >= km) {
        return points[i - 1]!.km >= points[i]!.km ? points[i]! : points[i - 1]!;
      }
    }
    return last;
  }

  function posXY(s: Fit | null): { x: number; y: number } | null {
    if (!s || positionKm == null) return null;
    return s.toXY(atKm(positionKm) ?? points[0]!);
  }

  function probeXY(s: Fit | null): { x: number; y: number } | null {
    if (!s || probeKm == null) return null;
    return s.toXY(atKm(probeKm) ?? points[0]!);
  }

  /**
   * Checkpoint pins, deduped by km and clamped onto the track. Two gates at the same km
   * (a CP is occasionally reinstated at the finish line) would stack labels on top of
   * each other and become unreadable at map scale; one pin per km is the honest render.
   */
  function pinsFor(s: Fit | null): Array<{ km: number; label: string; x: number; y: number; flip: boolean }> {
    if (!s) return [];
    const seen = new Set<number>();
    const out: Array<{ km: number; label: string; x: number; y: number; flip: boolean }> = [];
    for (const m of markers) {
      const km = Math.min(Math.max(m.km, points[0]!.km), points[points.length - 1]!.km);
      const key = Math.round(km * 10);
      if (seen.has(key)) continue;
      seen.add(key);
      const xy = s.toXY(atKm(km) ?? points[0]!);
      const label = m.label
        ? `${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)} · ${m.label}`
        : `KM ${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)}`;
      // a gate near the right edge would run its label out of the viewBox — flip the
      // anchor so the text grows inward over the track instead of being clipped
      const flip = xy.x + 70 > s.w;
      out.push({ km, label, x: xy.x, y: xy.y, flip });
    }
    return out;
  }

  /** Open the dialog: lock the page behind it and park focus on the panel. */
  function open() {
    expanded = true;
  }

  function onCardKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      open();
    }
  }

  /**
   * While expanded: freeze the page behind (a background scroll on touch would show the
   * race page sliding under the dialog) and honour Escape. Cleanup runs on close *and*
   * unmount, so the body style can never be left locked behind a route change.
   */
  $effect(() => {
    if (!expanded) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') expanded = false;
    };
    window.addEventListener('keydown', onKey);
    dialogEl?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

{#snippet mapSvg(s: Fit, k: number, hCss: string)}
  <!-- `k` scales every marker size: viewBox units only read as px at scale ≈ 1, so the
       360-wide expanded box needs double radii/fonts to land at the same physical size. -->
  <svg
    viewBox="0 0 {s.w} {s.h}"
    style="width:100%;height:{hCss};display:block;"
    role="img"
    aria-label="Route map with your position"
  >
    <!-- the track -->
    <path
      d={s.path}
      fill="none"
      stroke="rgba(255,255,255,0.82)"
      stroke-width={2.2 * Math.sqrt(k)}
      stroke-linejoin="round"
      stroke-linecap="round"
    />
    <!-- start / finish ticks: small, quiet, at the true first and last fixes -->
    {#if true}
      {@const a = s.toXY(points[0]!)}
      {@const b = s.toXY(points[points.length - 1]!)}
      <circle cx={a.x} cy={a.y} r={3 * k} fill="#ffffff" opacity="0.9" />
      <circle cx={b.x} cy={b.y} r={2.5 * k} fill="none" stroke="rgba(255,255,255,0.6)" stroke-width={1.2 * k} />
    {/if}
    <!-- inspect pointer: the elevation crosshair mirrored (drawn under the you-dot) -->
    {#if probeXY(s)}
      <circle cx={probeXY(s)!.x} cy={probeXY(s)!.y} r={8 * k} fill="rgba(255,179,90,0.18)" />
      <circle cx={probeXY(s)!.x} cy={probeXY(s)!.y} r={3.5 * k} fill="none" stroke="#ffb35a" stroke-width={1.6 * k} />
    {/if}
    <!-- checkpoint pins: amber tick + km label right on the track -->
    {#each pinsFor(s) as p, i (p.km)}
      <circle cx={p.x} cy={p.y} r={2.5 * k} fill="#ffb35a" stroke="#14161a" stroke-width={1 * k} />
      <!-- text is offset to the left unless there is room; odd/even alternate helps
           when two pins land close enough for their labels to share an edge -->
      <text
        x={p.x + (p.flip ? -5 * k : 5 * k)}
        y={p.y + (i % 2 === 0 ? -5 * k : 8 * k)}
        font-size={7 * k}
        font-weight="700"
        fill="rgba(255,255,255,0.85)"
        style="paint-order:stroke;stroke:#14161a;stroke-width:{2 * k}px;"
        text-anchor={p.flip ? 'end' : 'start'}
      >{p.label}</text>
    {/each}
    <!-- you -->
    {#if posXY(s)}
      <circle cx={posXY(s)!.x} cy={posXY(s)!.y} r={9 * k} fill="rgba(232,16,46,0.22)" />
      <circle cx={posXY(s)!.x} cy={posXY(s)!.y} r={4 * k} fill="#e8102e" stroke="#ffffff" stroke-width={1.4 * k} />
    {/if}
  </svg>
{/snippet}

{#if shape}
  <div
    class="rounded-2xl overflow-hidden relative group cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
    style="background:#14161a;"
    role="button"
    tabindex="0"
    aria-label="Expand route map full screen"
    onclick={open}
    onkeydown={onCardKey}
  >
    {@render mapSvg(shape, 1, `${height}px`)}
    <!-- affordance: the card is small and tappable, this says so without words -->
    <span
      class="absolute right-2 bottom-2 grid place-items-center rounded-pill border border-white/15 bg-black/45 p-1.5 text-white/70 transition-colors group-hover:bg-black/65 group-hover:text-white"
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9.5 2.5h4v4" />
        <path d="M6.5 13.5h-4v-4" />
        <path d="M13.5 2.5 9.4 6.6" />
        <path d="M2.5 13.5l4.1-4.1" />
      </svg>
    </span>
  </div>
{:else}
  <!-- Honest empty state: no GPS in the stored route, so no map can be drawn from it.
       Re-importing the GPX (today's writer keeps coordinates) brings it back. -->
  <div class="rounded-2xl border border-dashed border-hairline-strong bg-tile p-4 text-center" style="height:{height}px;">
    <p class="text-[11px] font-medium text-ink-dim m-0">No GPS track in this route row.</p>
    <p class="text-[10px] text-ink-dim m-0 mt-1">Re-import the GPX in the library to draw the map here.</p>
  </div>
{/if}

{#if expanded && bigShape}
  <div
    class="fixed inset-0 z-[90] flex flex-col"
    style="background:#14161a;"
    role="dialog"
    aria-modal="true"
    aria-label="Route map, expanded"
    tabindex={-1}
    bind:this={dialogEl}
  >
    <div class="flex items-center justify-between gap-3 px-4 pt-[calc(env(safe-area-inset-top,0px)+14px)] pb-3">
      <span class="text-[11px] font-bold uppercase tracking-[0.1em] text-on-mono-dim">Route map</span>
      <button
        class="grid h-9 w-9 place-items-center rounded-pill border border-white/15 bg-white/5 text-on-mono transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        aria-label="Close expanded map"
        onclick={() => (expanded = false)}
      >
        <Icon name="x" size={18} strokeWidth={2} />
      </button>
    </div>
    <div class="flex-1 min-h-0 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
      {@render mapSvg(bigShape, 2, '100%')}
    </div>
  </div>
{/if}
