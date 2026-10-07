<script lang="ts">
  import { onMount } from 'svelte';
  import { route } from '$lib/router.svelte';
  import AppNav from '$lib/components/AppNav.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import Dashboard from '$lib/routes/dashboard/Dashboard.svelte';
  import Rides from '$lib/routes/rides/Rides.svelte';
  import ActivityDetail from '$lib/routes/rides/ActivityDetail.svelte';
  import RoutesPage from '$lib/routes/routes/Routes.svelte';
  import Race from '$lib/routes/race/Race.svelte';
  import Gear from '$lib/routes/gear/Gear.svelte';
  import Coach from '$lib/routes/coach/Coach.svelte';
  import Settings from '$lib/routes/settings/Settings.svelte';
  import { ensureSeeded } from '$lib/data/seed';
  import { handleStravaCallback } from '$lib/infra/strava/connect';
  import { runAutoSync } from '$lib/infra/strava/autoSync';
  import { toast } from '$lib/toast.svelte';

  // Bottom clearance: nav capsule (64px) + floating gap (16px) + safe area (DESIGN.md)
  const navClearance = 'calc(88px + env(safe-area-inset-bottom, 0px))';

  onMount(() => {
    void boot();
  });

  /**
   * Boot order: schema + seed first, then the OAuth callback reader, then the Strava-first
   * auto-sync. The sync is last because it needs the schema open, and because its gate
   * reads the token row the callback may just have written — so a rider who lands back
   * from Strava's authorize screen gets their first rides pulled in the same visit,
   * without finding Settings first.
   */
  async function boot(): Promise<void> {
    await ensureSeeded();
    await reportStravaCallback();
    await runAutoSync();
  }

  /**
   * A Strava redirect lands on `/` with its `code` *before* the hash, so no route ever sees
   * it — this boot-time check is the only reader. The outcome becomes one honest toast; the
   * query string was already scrubbed inside the handler.
   */
  async function reportStravaCallback(): Promise<void> {
    const r = await handleStravaCallback(window.location.search);
    if (!r.handled) return;
    if (r.status === 'connected') toast.ok('Strava connected');
    else if (r.status === 'denied') toast.error(`Strava authorization declined (${r.error})`);
    else if (r.status === 'expired') toast.error('Connect timed out — press Connect Strava again');
    else if (r.status === 'state_mismatch') toast.error('Sign-in could not be verified — press Connect Strava again');
    else toast.error('Strava connection failed — press Connect Strava again');
  }
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

<!-- mounted once, above the nav: any route can report a failed write without owning a pill -->
<Toast />
