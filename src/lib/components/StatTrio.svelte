<script lang="ts">
  let {
    items
  }: {
    items: { label: string; value: string }[];
  } = $props();
</script>

<div class="grid grid-cols-3 divide-x divide-hairline text-center">
  {#each items as it (it.label)}
    <div class="flex flex-col items-center">
      <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim mb-1">{it.label}</span>
      <span class="text-lg font-extrabold text-ink text-tabular tracking-tight">{it.value}</span>
    </div>
  {/each}
</div>

