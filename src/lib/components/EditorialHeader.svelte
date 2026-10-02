<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Settings } from '@lucide/svelte';
  import { route } from '$lib/router.svelte';
  import ReminderBell from '$lib/components/ReminderBell.svelte';

  let {
    kicker,
    headline,
    sub,
    accent,
    /** editorial greeting mode: date kicker + time-of-day headline (no avatar, v5.4) */
    greeting,
    name,
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
    name?: string;
    children?: Snippet;
    showSettings?: boolean;
  } = $props();

  const now = new Date();
  const hour = now.getHours();
  const partOfDay = hour < 11 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
  const dateLine = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  const firstName = $derived((name ?? '').split(' ')[0] || 'Athlete');

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
        <Settings size={18} strokeWidth={1.5} />
      </a>
    {/if}
    {@render children?.()}
  </div>
{/snippet}

{#if greeting}
  <!-- Editorial greeting: date kicker + two-line headline, crimson italic name (no avatar) -->
  <header class="flex items-end justify-between gap-4">
    <div class="min-w-0">
      <span class="kicker block mb-1.5">{greeting} · {dateLine}</span>
      <h1 class="text-display uppercase text-ink">
        Good {partOfDay.toLowerCase()},<br />
        <span class="accent-italic normal-case">{firstName}</span>
      </h1>
    </div>
    {@render headerActions()}
  </header>
  {#if sub}
    <p class="text-sm text-ink-dim -mt-1">{sub}</p>
  {/if}
{:else}
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
