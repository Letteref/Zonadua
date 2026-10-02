<script lang="ts">
  let {
    series,
    height = 144
  }: {
    series: { date: string; ctl: number; atl: number }[];
    height?: number;
  } = $props();

  const W = 340;
  const H = 120;

  const geo = $derived.by(() => {
    const pts = series;
    if (pts.length < 2) return null;
    const vals = pts.flatMap((p) => [p.ctl, p.atl]);
    const min = Math.min(0, ...vals);
    const max = Math.max(...vals, 1);
    const x = (i: number) => (i / (pts.length - 1)) * W;
    const y = (v: number) => H - 10 - ((v - min) / (max - min)) * (H - 20);
    const step = Math.max(1, Math.floor(pts.length / 40));
    const idxs: number[] = [];
    for (let i = 0; i < pts.length; i += step) idxs.push(i);
    if (idxs.at(-1) !== pts.length - 1) idxs.push(pts.length - 1);
    const ctlPath = idxs.map((i, k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pts[i].ctl).toFixed(1)}`).join(' ');
    const atlPath = idxs.map((i, k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pts[i].atl).toFixed(1)}`).join(' ');
    const area = `${ctlPath} L${W},${H - 6} L0,${H - 6} Z`;
    return { ctlPath, atlPath, area, endCtl: y(pts.at(-1)!.ctl), endAtl: y(pts.at(-1)!.atl) };
  });

  const months = $derived.by(() => {
    if (series.length < 2) return [];
    const out: { label: string; x: number }[] = [];
    let lastMonth = -1;
    for (let i = 0; i < series.length; i++) {
      const m = new Date(series[i].date).getMonth();
      if (m !== lastMonth) {
        lastMonth = m;
        out.push({
          label: new Date(series[i].date).toLocaleDateString('en-GB', { month: 'short' }),
          x: (i / (series.length - 1)) * 100
        });
      }
    }
    return out;
  });
</script>

<div>
  <div class="relative w-full overflow-visible" style="height:{height}px">
    {#if geo}
      <svg class="w-full h-full overflow-visible" fill="none" preserveAspectRatio="none" viewBox="0 0 {W} {H}">
        <defs>
          <linearGradient id="ctlGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#e8102e" stop-opacity="0.22" />
            <stop offset="100%" stop-color="#e8102e" stop-opacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2={W} y1="30" y2="30" stroke="#e8eaed" stroke-dasharray="2 4" stroke-width="1" />
        <line x1="0" x2={W} y1="70" y2="70" stroke="#e8eaed" stroke-dasharray="2 4" stroke-width="1" />
        <line x1="0" x2={W} y1={H - 10} y2={H - 10} stroke="#d9dce0" stroke-width="1" />
        <path d={geo.atlPath} fill="none" stroke="#8b8f96" stroke-dasharray="3 3" stroke-width="1.5" />
        <path d={geo.area} fill="url(#ctlGrad)" />
        <path d={geo.ctlPath} fill="none" stroke="#e8102e" stroke-linecap="round" stroke-width="2.5" />
        <circle cx={W} cy={geo.endCtl} r="4.5" fill="#e8102e" stroke="#ffffff" stroke-width="2" />
        <circle cx={W} cy={geo.endAtl} r="3.5" fill="#8b8f96" stroke="#ffffff" stroke-width="1.5" />
      </svg>
    {:else}
      <div class="grid h-full place-items-center"><span class="kicker">Not enough data yet</span></div>
    {/if}
  </div>
  {#if months.length > 1}
    <div class="relative mt-2 h-4 border-t border-hairline">
      {#each months as m (m.label + m.x)}
        <span
          class="absolute text-[11px] font-semibold text-ink-dim"
          style="left:{m.x}%; transform:translateX(-{Math.round(m.x)}%);"
        >
          {m.label}
        </span>
      {/each}
    </div>
  {/if}
</div>
