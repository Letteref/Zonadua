<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import type { Snippet } from 'svelte';
    import { route } from '$lib/router.svelte';
  import ReminderBell from '$lib/components/ReminderBell.svelte';

  let {
    kicker,
    headline,
    sub,
    accent,
    /** editorial greeting mode: date kicker + time-of-day headline (no avatar, v5.4) */
    greeting,
    /** page-specific actions rendered after the global actions */
    children,
    /** global header actions on every page — Gear lives in the nav bar (v5.3) */
    showSettings = true
  }: {
    kicker?: string;
    headline?: string;
    sub?: string;
    accent?: string;
    greeting?: string;
    children?: Snippet;
    showSettings?: boolean;
  } = $props();

  const now = new Date();
  const hour = now.getHours();
  const partOfDay = hour < 11 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
  const dateLine = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

  // Don't link to the page you're already on
  const showSettingsLink = $derived(showSettings && route.name !== 'settings');
</script>

{#snippet headerActions()}
  <div class="flex items-center gap-2 shrink-0">
    <ReminderBell />
    {#if showSettingsLink}
      <a
        href="#/settings"
        class="h-10 w-10 rounded-pill bg-surface border border-hairline grid place-items-center text-ink-dim hover:text-ink transition-colors elevation-card"
        aria-label="Settings"
        title="Settings"
      >
        <Icon name="settings" size={18} strokeWidth={1.5} />
      </a>
    {/if}
    {@render children?.()}
  </div>
{/snippet}

{#if greeting}
  <!--
    Editorial greeting: date kicker + a single-line time-of-day headline.

    This used to hang the rider's name under "GOOD MORNING" in accent italic, which gave the
    header a two-line shape. But the name was never editable — it is seeded as "Andi" and no
    screen in the app writes to it — so every rider saw someone else's name on the first screen
    of the app, in the largest type it owns. Removing it costs the accent span; keeping a name
    here is only honest once Settings can set one.

    The two-line title rule that follows still holds for the ordinary page headers below, where
    real headlines wrap.
  -->
  <header class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      <span class="kicker block mb-1.5">{greeting} · {dateLine}</span>
      <h1 class="text-display uppercase text-ink">Good {partOfDay.toLowerCase()}</h1>
    </div>
    {@render headerActions()}
  </header>
  {#if sub}
    <p class="text-sm text-ink-dim -mt-1">{sub}</p>
  {/if}
{:else}
  <!--
    Actions live in the **top-right corner**, flush with the top of the header block, on
    every page including the greeting header above. That is the fundamental rule: the
    action cluster is chrome, not content, so it anchors to the top edge of the region it
    belongs to and the title column owns everything below it.

    An earlier pass bottom-aligned the actions to the subtitle instead, on the reasoning
    that a two-line headline left them orphaned beside the eyebrow. It was wrong: it left
    a band of dead space above the icons, put them level with the least important line in
    the block, and made them read as part of the title's baseline rhythm. The greeting
    header was the actual outlier, so both branches now share `items-start` and the rule
    holds for one-line and two-line titles alike.

    The title block is untouched: kicker, headline and sub keep their own stacking, and
    the only thing this alignment moves is the vertical position of the icon cluster.
  -->
  <header class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      {#if kicker}
        <span class="kicker block mb-1.5">{kicker}</span>
      {/if}
      {#if headline}
        <h1 class="text-display uppercase text-ink">{headline}</h1>
      {/if}
      {#if sub}
        <p class="text-sm text-ink-dim mt-1.5 font-medium">
          {sub}{#if accent}<span class="accent-italic"> {accent}</span>{/if}
        </p>
      {/if}
    </div>
    {@render headerActions()}
  </header>
{/if}
