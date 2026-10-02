<script lang="ts">
  let {
    label,
    value,
    unit,
    sub,
    delta,
    deltaTone = 'dim',
    variant = 'tile',
    href
  }: {
    label: string;
    value: string;
    unit?: string;
    sub?: string;
    delta?: string;
    deltaTone?: 'up' | 'down' | 'dim';
    variant?: 'tile' | 'mono' | 'flare';
    href?: string;
  } = $props();

  const base = 'rounded-2xl p-4 min-w-0 flex flex-col justify-between text-left';
  const styles = {
    tile: 'bg-tile border border-hairline',
    mono: 'bg-mono text-on-mono glow-soft bg-mono-gradient',
    flare: 'bg-crimson-gradient text-white glow-crimson'
  } as const;
  const tone = {
    up: 'text-aman',
    down: 'text-crimson-deep',
    dim: 'text-ink-dim'
  } as const;
</script>

<svelte:element
  this={href ? 'a' : 'div'}
  href={href}
  class="{base} {styles[variant]}"
>
  <span
    class="text-[10px] font-bold uppercase tracking-wider truncate {variant === 'tile'
      ? 'text-ink-dim'
      : variant === 'flare'
        ? 'text-white'
        : 'text-on-mono-dim'}"
  >
    {label}
  </span>
  <span class="my-2 flex items-baseline gap-0.5">
    <span
      class="text-[28px] leading-none font-bold tracking-tight text-tabular {variant === 'flare'
        ? 'text-white'
        : variant === 'mono'
          ? 'text-on-mono'
          : 'text-ink'}"
    >
      {value}
    </span>
    {#if unit}
      <span class="text-sm font-semibold ml-0.5 {variant === 'tile'
        ? 'text-ink-dim'
        : variant === 'flare'
          ? 'text-white'
          : 'text-on-mono-dim'}">
        {unit}
      </span>
    {/if}
  </span>
  {#if delta}
    <span class="flex items-center gap-1 text-[11px] font-semibold {variant === 'tile'
      ? tone[deltaTone]
      : variant === 'flare'
        ? 'text-white'
        : deltaTone === 'down'
          ? 'text-rose'
          : 'text-on-mono-dim'}">
      {#if deltaTone === 'up'}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
      {:else if deltaTone === 'down'}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>
      {/if}
      {delta}
    </span>
  {:else if sub}
    <span class="text-[11px] font-medium {variant === 'tile'
      ? 'text-ink-dim'
      : variant === 'flare'
        ? 'text-white'
        : 'text-on-mono-dim'}">{sub}</span>
  {/if}
</svelte:element>
