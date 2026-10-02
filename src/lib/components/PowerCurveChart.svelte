<script lang="ts">
  import type { CriticalPowerFit, CurvePoint } from '$lib/domain/power-curve';
  import { fmtDuration } from '$lib/domain/zones';

  let {
    curve,
    fit,
    compare,
    height = 150
  }: {
    curve: CurvePoint[];
    fit?: CriticalPowerFit;
    /** reference curve drawn behind (e.g. the athlete's all-time best) */
    compare?: CurvePoint[];
    height?: number;
  } = $props();

  const W = 340;
  const H = 130;
  const PAD = { top: 12, bottom: 18 };

  const MIN_X = 1;
  const MAX_X = 43200; // 12 h

  const geo = $derived.by(() => {
    if (curve.length < 2) return null;

    const maxW = Math.max(...curve.map((p) => p.watts), fit?.cp ?? 0) * 1.08;
    const logMin = Math.log10(MIN_X);
    const logMax = Math.log10(MAX_X);
    const x = (sec: number) =>
      ((Math.log10(Math.min(MAX_X, Math.max(MIN_X, sec))) - logMin) / (logMax - logMin)) * W;
    const y = (w: number) => H - PAD.bottom - (w / maxW) * (H - PAD.top - PAD.bottom);

    const pts = [...curve].sort((a, b) => a.durationSec - b.durationSec);
    const path = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.durationSec).toFixed(1)},${y(p.watts).toFixed(1)}`)
      .join(' ');
    const area = `${path} L${x(pts.at(-1)!.durationSec).toFixed(1)},${y(0).toFixed(1)} L${x(pts[0].durationSec).toFixed(1)},${y(0).toFixed(1)} Z`;

    // CP asymptote, drawn across the plot
    const cpY = fit ? y(fit.cp) : null;

    // Model curve P = W'/t + CP, sampled across the visible range
    const model = fit
      ? [60, 120, 300, 600, 1200, 2400, 3600, 7200, 14400]
          .filter((sec) => fit.cp + fit.wPrime / sec <= maxW)
          .map((sec, i) => `${i === 0 ? 'M' : 'L'}${x(sec).toFixed(1)},${y(fit.cp + fit.wPrime / sec).toFixed(1)}`)
          .join(' ')
      : null;

    // reference curve (all-time best) behind the measured one
    const comparePath =
      compare && compare.length >= 2
        ? [...compare]
            .sort((a, b) => a.durationSec - b.durationSec)
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.durationSec).toFixed(1)},${y(Math.min(p.watts, maxW)).toFixed(1)}`)
            .join(' ')
        : null;

    const ticks = [
      { label: '1s', sec: 1 },
      { label: '1m', sec: 60 },
      { label: '5m', sec: 300 },
      { label: '20m', sec: 1200 },
      { label: '1h', sec: 3600 },
      { label: '3h', sec: 10800 }
    ];

    return {
      path,
      area,
      cpY,
      model,
      comparePath,
      maxW,
      x,
      y,
      ticks,
      longestSec: pts.at(-1)!.durationSec
    };
  });
</script>

<div>
  {#if geo}
    <div class="relative w-full" style="height:{height}px">
      <svg
        class="w-full h-full overflow-visible"
        fill="none"
        preserveAspectRatio="none"
        viewBox="0 0 {W} {H}"
        role="img"
        aria-label="Mean maximal power curve with critical power model"
      >
        <defs>
          <linearGradient id="pcGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#e8102e" stop-opacity="0.2" />
            <stop offset="100%" stop-color="#e8102e" stop-opacity="0" />
          </linearGradient>
        </defs>

        <!-- horizontal guides -->
        {#each [0.25, 0.5, 0.75] as f (f)}
          <line
            x1="0"
            x2={W}
            y1={H - PAD.bottom - f * (H - PAD.top - PAD.bottom)}
            y2={H - PAD.bottom - f * (H - PAD.top - PAD.bottom)}
            stroke="#e8eaed"
            stroke-dasharray="2 4"
          />
        {/each}

        <!-- CP asymptote -->
        {#if geo.cpY !== null}
          <line x1="0" x2={W} y1={geo.cpY} y2={geo.cpY} stroke="#62656c" stroke-dasharray="4 3" stroke-width="1" />
        {/if}

        <!-- fitted model -->
        {#if geo.model}
          <path d={geo.model} fill="none" stroke="#9ba1aa" stroke-dasharray="2 3" stroke-width="1.25" />
        {/if}

        <!-- reference curve -->
        {#if geo.comparePath}
          <path d={geo.comparePath} fill="none" stroke="#62656c" stroke-width="1.25" stroke-linejoin="round" />
        {/if}

        <path d={geo.area} fill="url(#pcGrad)" />
        <path d={geo.path} fill="none" stroke="#e8102e" stroke-linejoin="round" stroke-width="2.5" />

        <line
          x1="0"
          x2={W}
          y1={H - PAD.bottom}
          y2={H - PAD.bottom}
          stroke="#d9dce0"
          stroke-width="1"
        />
      </svg>

      {#if geo.cpY !== null && fit}
        <span
          class="absolute right-0 -translate-y-1/2 rounded-pill bg-tile px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ink-dim"
          style="top:{(geo.cpY / H) * 100}%"
        >
          CP {fit.cp} W
        </span>
      {/if}
    </div>

    <div class="relative mt-1 h-4 text-[10px] font-semibold text-ink-dim">
      {#each geo.ticks as t (t.label)}
        <span
          class="absolute -translate-x-1/2"
          style="left:{((Math.log10(t.sec) - Math.log10(MIN_X)) / (Math.log10(MAX_X) - Math.log10(MIN_X))) * 100}%"
        >
          {t.label}
        </span>
      {/each}
    </div>

    {#if geo.longestSec < 7200}
      <p class="mt-1 text-[11px] font-medium text-ink-dim">
        Longest measured effort: {fmtDuration(geo.longestSec)} — the curve is flat past that point
        because it was never measured there.
      </p>
    {/if}
  {:else}
    <div class="grid place-items-center" style="height:{height}px">
      <span class="kicker">No power data yet</span>
    </div>
  {/if}
</div>