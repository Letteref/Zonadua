<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    kicker,
    right,
    chrome,
    dark = false,
    children
  }: {
    kicker?: string;
    right?: Snippet;
    /** full-bleed chrome strip rendered above the card body (browser-chrome row, dark cards) */
    chrome?: Snippet;
    /** dark monolith card (hero sections) */
    dark?: boolean;
    children: Snippet;
  } = $props();
</script>

<section class="flex flex-col gap-2.5">
  {#if kicker}
    <span class="kicker">{kicker}</span>
  {/if}
  <div
    class="rounded-card overflow-hidden {dark
      ? 'bg-mono text-on-mono glow-mono bg-mono-gradient'
      : 'bg-surface border border-hairline elevation-card'}"
  >
    {#if chrome}
      {@render chrome()}
    {/if}
    <div class="p-5">
    {#if right}
      <div class="flex items-center justify-between mb-4">
        {@render right()}
      </div>
    {/if}
    {@render children()}
    </div>
  </div>
</section>
