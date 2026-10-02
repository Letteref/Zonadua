<script lang="ts">
  import type { TrendSeries } from '$lib/domain/trend';

  let {
    trend,
    height = 168
  }: {
    trend: TrendSeries;
    height?: number;
  } = $props();

  const W = 340;
  const H = 120;
  const PAD = { top: 14, bottom: 20 };

  const geo = $derived.by(() => {
    const hasWeight = trend.weight.length >= 2;
    const hasFtp = trend.ftp.length >= 2;
    if (!hasWeight && !hasFtp) return null;

    const tMax = Math.max(1, ...trend.points.map((p) => p.t));
    const x = (t: number) => (t / tMax) * W;

    // independent y scales: kg and W share a plot but never a scale
    const kgVals = trend.weight.map((p) => p.kg);
    const kgMin = Math.min(...kgVals) - 0.6;
    const kgMax = Math.max(...kgVals) + 0.6;
    const yKg = (kg: number) => H - PAD.bottom - ((kg - kgMin) / (kgMax - kgMin || 1)) * (H - PAD.top - PAD.bottom);

    const wVals = trend.ftp.map((p) => p.w);
    const wMin = Math.min(...wVals) - 8;
    const wMax = Math.max(...wVals) + 8;
    const yFtp = (w: number) => H - PAD.bottom - ((w - wMin) / (wMax - wMin || 1)) * (H - PAD.top - PAD.bottom);

    // weight is sparse and honest: straight segments, no smoothing
    const weightPath = hasWeight
      ? trend.weight.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${yKg(p.kg).toFixed(1)}`).join(' ')
      : null;

    // FTP is a step function, so draw it as steps rather than a diagonal lie
    const ftpPath = hasFtp
      ? trend.ftp
          .map((p, i) => {
            const px = x(p.t).toFixed(1);
            const py = yFtp(p.w).toFixed(1);
            if (i === 0) return `M${px},${py}`;
            const prevX = x(trend.ftp[i - 1].t).toFixed(1);
            return `L${prevX},${py} L${px},${py}`;
          })
          .join(' ')
      : null;

    const labels: { t: number; label: string }[] = [];
    const spanDays = tMax;
    const steps = spanDays > 240 ? [0, 60, 120, 180, 240, 300] : spanDays > 120 ? [0, 30, 60, 90, 120] : [0, 30, 60, 90];
    const today = new Date();
    for (const d of steps) {
      if (d > spanDays) continue;
      const date = new Date(today);
      date.setDate(today.getDate() - (spanDays - d));
      labels.push({ t: d, label: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) });
    }

    return {
      weightPath,
      ftpPath,
      x,
      labels,
      maxT: tMax,
      kgLo: Math.round(kgMin * 10) / 10,
      kgHi: Math.round(kgMax * 10) / 10,
      wLo: Math.round(wMin),
      wHi: Math.round(wMax),
      lastKg: trend.weight.at(-1)?.kg,
      lastFtp: trend.ftp.at(-1)?.w
    };
  });
</script>

{#if geo}
  <div class="relative w-full" style="height:{height}px">
    <svg
      class="w-full h-full overflow-visible"
      fill="none"
      preserveAspectRatio="none"
      viewBox="0 0 {W} {H}"
      role="img"
      aria-label="Body weight and FTP over time"
    >
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

      {#if geo.ftpPath}
        <path d={geo.ftpPath} fill="none" stroke="#62656c" stroke-width="1.75" stroke-linejoin="round" />
      {/if}
      {#if geo.weightPath}
        <path d={geo.weightPath} fill="none" stroke="#e8102e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        <circle
          cx={geo.x(trend.weight.at(-1)!.t)}
          cy={geo.lastKg != null ? H - PAD.bottom - ((geo.lastKg - geo.kgLo) / (geo.kgHi - geo.kgLo || 1)) * (H - PAD.top - PAD.bottom) : 0}
          r="4"
          fill="#e8102e"
          stroke="#fff"
          stroke-width="2"
        />
      {/if}

      <line x1="0" x2={W} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="#d9dce0" />
    </svg>

    <span class="absolute left-0 top-0 text-[10px] font-bold uppercase tracking-wider text-crimson-deep">
      {geo.kgLo}–{geo.kgHi} kg
    </span>
    {#if geo.ftpPath}
      <span class="absolute right-0 top-0 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
        {geo.wLo}–{geo.wHi} W
      </span>
    {/if}
  </div>

  <div class="relative mt-1 h-4 text-[10px] font-semibold text-ink-dim">
    {#each geo.labels as l (l.t)}
      <span
        class="absolute whitespace-nowrap {l.t <= 0
          ? ''
          : l.t >= geo.maxT
            ? '-translate-x-full'
            : '-translate-x-1/2'}"
        style="left:{geo.maxT > 0 ? (l.t / geo.maxT) * 100 : 0}%"
      >
        {l.label}
      </span>
    {/each}
  </div>
{:else}
  <div class="grid place-items-center py-8 text-center">
    <span class="kicker">Log weight or FTP to see the trend</span>
  </div>
{/if}