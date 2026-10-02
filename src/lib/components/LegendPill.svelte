<script lang="ts">
  let {
    items
  }: {
    /** dot: 'signal' solid orange, 'outline' hollow gray */
    items: { label: string; dot: 'signal' | 'outline' }[];
  } = $props();
</script>

<div class="flex items-center gap-2">
  {#each items as it (it.label)}
    <div
      class="flex items-center gap-1.5 rounded-pill px-2.5 py-1 border bg-tile {it.dot === 'signal'
        ? 'border-hairline-strong'
        : 'border-hairline'}"
    >
      <span
        class="h-1.5 w-1.5 rounded-pill {it.dot === 'signal' ? 'bg-crimson' : 'border border-ink-dim'}"
      ></span>
      <span
        class="text-[10px] font-bold uppercase tracking-wider {it.dot === 'signal'
          ? 'text-ink'
          : 'text-ink-dim'}"
      >
        {it.label}
      </span>
    </div>
  {/each}
</div>
