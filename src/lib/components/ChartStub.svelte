<script lang="ts">
  let {
    label,
    sub,
    height = 120,
    bars
  }: {
    label?: string;
    sub?: string;
    height?: number;
    bars?: { label: string; value: number; max: number; accent?: boolean }[];
  } = $props();
</script>

<div class="relative rounded-control bg-canvas border border-hairline overflow-hidden" style="height:{height}px">
  <div
    class="absolute inset-0 opacity-20"
    style="background-image: repeating-linear-gradient(90deg, #d9dce0 0, #d9dce0 1px, transparent 1px, transparent 24%);background-size:100% 100%;"
  ></div>
  <div class="absolute inset-x-0 bottom-0 h-2/3 bg-signature-gradient opacity-[0.08]"></div>
  {#if bars}
    <div class="absolute inset-x-3 bottom-3 top-6 flex items-end gap-1.5">
      {#each bars as b (b.label)}
        <div class="flex-1 rounded-t-sm {b.accent ? 'bg-signal' : 'bg-ink-dim/50'}" style="height:{Math.max(4, (b.value / b.max) * 100)}%"></div>
      {/each}
    </div>
  {/if}
  <div class="absolute inset-x-4 top-3 flex items-baseline justify-between gap-2">
    <span class="kicker">{label ?? ''}</span>
    <span class="kicker !tracking-normal">{sub ?? ''}</span>
  </div>
</div>
