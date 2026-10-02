<script lang="ts">
  import { onMount } from 'svelte';
  import { route } from '$lib/router.svelte';
  import AppNav from '$lib/components/AppNav.svelte';
  import Dashboard from '$lib/routes/dashboard/Dashboard.svelte';
  import Rides from '$lib/routes/rides/Rides.svelte';
  import ActivityDetail from '$lib/routes/rides/ActivityDetail.svelte';
  import RoutesPage from '$lib/routes/routes/Routes.svelte';
  import Race from '$lib/routes/race/Race.svelte';
  import Gear from '$lib/routes/gear/Gear.svelte';
  import Coach from '$lib/routes/coach/Coach.svelte';
  import Settings from '$lib/routes/settings/Settings.svelte';
  import { ensureSeeded } from '$lib/data/seed';

  // Bottom clearance: nav capsule (64px) + floating gap (16px) + safe area (DESIGN.md)
  const navClearance = 'calc(88px + env(safe-area-inset-bottom, 0px))';

  onMount(() => {
    void ensureSeeded();
  });
</script>

<div class="min-h-dvh" style="padding-bottom: {navClearance};">
  {#if route.name === 'rides'}
    {#if route.detailParam}
      <ActivityDetail id={route.detailParam} />
    {:else}
      <Rides />
    {/if}
  {:else if route.name === 'routes'}
    <RoutesPage />
  {:else if route.name === 'race'}
    <Race />
  {:else if route.name === 'gear'}
    <Gear />
  {:else if route.name === 'coach'}
    <Coach />
  {:else if route.name === 'settings'}
    <Settings />
  {:else}
    <Dashboard />
  {/if}
</div>

<AppNav />
