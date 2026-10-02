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
      <!--
        `justify-end`, not `justify-between`.

        Every caller passes exactly one element to this slot, and `justify-between` with a
        single child always resolves to the left — so a slot named `right` had never once
        right-aligned anything in the app, leaving measured dead space beside it (192 px in
        the Fitness & fatigue card, 61 px in Power curve). `justify-end` is what the prop
        has always promised, and it behaves identically for a caller who later passes two
        children *and wants them apart* only if that caller opts out via their own wrapper.
      -->
      <div class="flex items-center justify-end gap-2 mb-4" data-slot="right">
        {@render right()}
      </div>
    {/if}
    {@render children()}
    </div>
  </div>
</section>
