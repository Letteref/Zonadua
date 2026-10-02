<script lang="ts">
  let {
    pct,
    status = 'signal',
    marker = false,
    onDark = false
  }: {
    pct: number;
    status?: 'aman' | 'waspada' | 'kritis' | 'signal';
    marker?: boolean;
    onDark?: boolean;
  } = $props();

  const fillLight: Record<string, string> = {
    aman: '#0a7450',
    waspada: '#b8620a',
    kritis: '#c8102e',
    signal: '#e8102e'
  };
  const fillDark: Record<string, string> = {
    aman: '#4ade9a',
    waspada: '#ffb35a',
    kritis: '#ff8a92',
    signal: '#ff4d5e'
  };
  const p = $derived(Math.max(0, Math.min(100, pct * 100)));
</script>

<div
  class="relative h-2 rounded-pill overflow-hidden"
  style="background:{onDark ? '#23252c' : '#f1f2f4'};border:1px solid {onDark ? '#2b2d33' : '#d9dce0'};"
  role="progressbar"
  aria-valuenow={Math.round(p)}
  aria-valuemin={0}
  aria-valuemax={100}
>
  <div class="absolute inset-0 bg-hatch opacity-15"></div>
  <div
    class="absolute inset-y-0 left-0 rounded-pill {status === 'signal' ? 'bg-crimson-gradient glow-crimson' : ''}"
    style="width:{p}%;background:{status === 'signal' ? undefined : (onDark ? fillDark : fillLight)[status]};"
  ></div>
  {#if marker}
    <div
      class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-3 rounded-pill bg-white border-2 border-crimson elevation-card"
      style="left:{p}%;"
    ></div>
  {/if}
</div>
