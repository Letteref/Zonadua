<script lang="ts">
  let {
    days,
    target,
    height = 112,
    onDark = false
  }: {
    days: { date: string; tss: number }[];
    target: number;
    height?: number;
    /** monolith variant: hairline/bars adapted for dark cards */
    onDark?: boolean;
  } = $props();

  const LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const max = $derived(Math.max(target * 0.6, ...days.map((d) => d.tss), 1));
  const peakIdx = $derived(days.reduce((best, d, i) => (d.tss > days[best].tss ? i : best), 0));
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
</script>

<div class="relative" style="height:{height}px">
  <div
    class="absolute inset-x-0 flex items-center justify-between pointer-events-none"
    style="top:{Math.round(Math.min(88, Math.max(0, (1 - target / max) * 82)))}%"
  >
    <div class="flex-1 border-b border-dashed {onDark ? 'border-[#3a3d45]' : 'border-hairline-strong'}"></div>
    <span class="text-[9px] font-bold uppercase tracking-widest {onDark ? 'text-on-mono-dim' : 'text-ink-dim'} pl-2">Target {fmt(target)}</span>
  </div>
  <div class="absolute inset-0 flex items-end justify-between gap-2.5 pt-5 pb-6">
    {#each days as d, i (d.date)}
      <div class="flex-1 h-full flex flex-col items-center justify-end gap-2">
        <div
          class="w-full rounded-t-md transition-all {i === peakIdx && d.tss > 0
            ? 'bg-signature-gradient glow-crimson'
            : onDark
              ? 'bg-[#23252c] border border-[#2b2d33] hover:border-[#3a3d45]'
              : 'bg-tile border border-hairline hover:border-hairline-strong'}"
          style="height:{Math.max(3, (d.tss / max) * 100)}%"
        ></div>
      </div>
    {/each}
  </div>
  <div class="absolute inset-x-0 bottom-0 flex justify-between gap-2.5">
    {#each days as d, i (d.date)}
      <span
        class="flex-1 text-center text-[11px] {i === peakIdx && d.tss > 0
          ? onDark
            ? 'font-bold text-rose'
            : 'font-bold text-crimson-deep'
          : onDark
            ? 'font-medium text-on-mono-dim'
            : 'font-medium text-ink-dim'}"
      >
        {LABELS[new Date(d.date).getDay()]}
      </span>
    {/each}
  </div>
</div>
