<script lang="ts">
  import { onMount } from 'svelte';
  import { route } from '$lib/router.svelte';
  import AppNav from '$lib/components/AppNav.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import Dashboard from '$lib/routes/dashboard/Dashboard.svelte';
  import Rides from '$lib/routes/rides/Rides.svelte';
  import ActivityDetail from '$lib/routes/rides/ActivityDetail.svelte';
  import RoutesPage from '$lib/routes/routes/Routes.svelte';
  import LibraryPage from '$lib/routes/library/Library.svelte';
  import Race from '$lib/routes/race/Race.svelte';
  import Gear from '$lib/routes/gear/Gear.svelte';
  import Load from '$lib/routes/load/Load.svelte';
  import Settings from '$lib/routes/settings/Settings.svelte';
  import Onboarding from '$lib/routes/onboarding/Onboarding.svelte';
  import Landing from '$lib/routes/landing/Landing.svelte';
  import { ensureSeeded } from '$lib/data/seed';
  import { hasSeenLanding, isOnboarded, markLandingSeen } from '$lib/data/onboarding.svelte';
  import { handleStravaCallback } from '$lib/infra/strava/connect';
  import { runAutoSync } from '$lib/infra/strava/autoSync';
  import { toast } from '$lib/toast.svelte';

  // Bottom clearance: nav capsule (64px) + floating gap (16px) + safe area (DESIGN.md)
  const navClearance = 'calc(88px + env(safe-area-inset-bottom, 0px))';

  onMount(() => {
    void boot();
  });

  /**
   * What this device still owes the rider: the welcome landing first, then the setup flow.
   * Both are read once, synchronously, at the top of boot — before any table is touched —
   * because they decide which shell renders. Both live in localStorage (see
   * onboarding.svelte.ts) so they survive "Erase everything".
   *
   * `landing` flips off the moment Get started is pressed, so a reload halfway through
   * setup resumes the setup instead of pitching the app a second time.
   */
  const gate = $state({ needs: !isOnboarded(), landing: !isOnboarded() && !hasSeenLanding() });

  /**
   * Boot order: schema + seed first, then the OAuth callback reader, then the Strava-first
   * auto-sync. The sync is last because it needs the schema open, and because its gate
   * reads the token row the callback may just have written — so a rider who lands back
   * from Strava's authorize screen gets their first rides pulled in the same visit,
   * without finding Settings first.
   *
   * The sync is skipped while onboarding is showing: a brand-new rider has no token to
   * refresh and nothing to pull, and running it would only race the setup writes.
   */
  async function boot(): Promise<void> {
    await ensureSeeded();
    await reportStravaCallback();
    if (!gate.needs) await runAutoSync();
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

{#if gate.needs && route.name !== 'settings'}
  <!--
    First-run shell: the welcome landing, then the five-step setup behind its Get started
    button. Both take the whole viewport — no bottom nav, no page chrome — because the
    rider has nothing to navigate to yet. Settings stays reachable so someone who lands
    here by mistake can back out, but the shell stays the default until setup is finished
    or skipped.
  -->
  {#if gate.landing}
    <Landing
      onstart={() => {
        markLandingSeen();
        gate.landing = false;
      }}
    />
  {:else}
    <Onboarding ondone={() => (gate.needs = false)} />
  {/if}
{:else}
  <div class="min-h-dvh" style="padding-bottom: {navClearance};">
    {#if route.name === 'rides'}
      {#if route.detailParam}
        <ActivityDetail id={route.detailParam} />
      {:else}
        <Rides />
      {/if}
    {:else if route.name === 'routes'}
      <RoutesPage />
    {:else if route.name === 'library'}
      <LibraryPage />
    {:else if route.name === 'race'}
      <Race />
    {:else if route.name === 'gear'}
      <Gear />
    {:else if route.name === 'load'}
      <Load />
    {:else if route.name === 'settings'}
      <Settings />
    {:else}
      <Dashboard />
    {/if}
  </div>

  <AppNav />
{/if}

<!-- mounted once, above the nav: any route can report a failed write without owning a pill -->
<Toast />
