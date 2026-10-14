<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import EditorialHeader from '$lib/components/EditorialHeader.svelte';
  import CircleButton from '$lib/components/CircleButton.svelte';
  import { allRoutes, appSettings } from '$lib/data/queries.svelte';
  import { db } from '$lib/data/db';
  import { parseAndStoreRoute } from '$lib/data/route-import';
  import { formatDistance, formatElevation, type UnitSystem } from '$lib/domain/units';
  import { toast } from '$lib/toast.svelte';

  /**
   * Route library — every GPX the rider has imported, in one list.
   *
   * The rows are the preview entry point: tapping one opens `#/routes/:id`, where
   * Routes.svelte decodes the stored profile and runs the estimator on it. Nothing is
   * synthesised here — distance, gain and date come straight off the stored row, and an
   * empty library says so instead of showing sample rows a rider never imported.
   *
   * Delete is two-tap, the same contract Gear uses for components: the first press arms
   * the row, the second commits it. A stored route is the only copy of that GPX on the
   * device, so one stray tap must never be able to destroy it.
   */
  const unit = $derived<UnitSystem>(appSettings.current?.unit ?? 'metric');

  /** newest import first — the route most likely to be previewed sits at the top */
  const routes = $derived(
    [...(allRoutes.current ?? [])].sort((a, b) => b.createdAt - a.createdAt)
  );

  const totalKm = $derived(routes.reduce((s, r) => s + (r.distanceKm || 0), 0));

  /** the row armed for deletion; null = nothing armed */
  let confirmId = $state<string | null>(null);

  let fileInput: HTMLInputElement | null = $state(null);

  /**
   * Import straight into the library — the row appears via the `allRoutes` liveQuery and
   * the rider stays put. The estimator is deliberately not part of this journey: storing
   * a route and riding it are different errands, and forcing the first through the second
   * made the library a detour on its own home screen.
   */
  async function onGpxPick(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    toast.busy('Parsing route…');
    try {
      const r = await parseAndStoreRoute(file);
      toast.ok(
        `Saved ${r.name} — ${formatDistance(r.distanceKm, unit)} · ${formatElevation(r.elevGainM, unit)} of climbing`
      );
    } catch (err) {
      console.error('[zonadua] library import failed:', err);
      toast.error('Import failed — use a GPX file with trackpoints');
    }
  }

  function fmtDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  async function remove(id: string, name: string): Promise<void> {
    if (confirmId !== id) {
      confirmId = id;
      return;
    }
    try {
      await db.routes.delete(id);
      toast.ok(`${name} deleted`);
    } catch (err) {
      console.error('[zonadua] route delete failed:', err);
      // the row is still there — say so, or the rider assumes the delete worked
      toast.error(`Could not delete ${name}`);
    } finally {
      confirmId = null;
    }
  }
</script>

<div class="mx-auto max-w-md px-5 pt-8 pb-10 flex flex-col gap-5">
  <EditorialHeader
    kicker="Route library"
    headline="Saved routes"
    sub={allRoutes.ready ? `${routes.length} stored on this device —` : 'Stored on this device —'}
    accent={routes.length
      ? `${formatDistance(totalKm, unit)} total. Tap one to preview.`
      : 'every GPX you import lands here.'}
  >
    <CircleButton icon="file-up" label="Import GPX" onclick={() => fileInput?.click()} />
  </EditorialHeader>

  <input
    bind:this={fileInput}
    class="hidden"
    type="file"
    accept=".gpx"
    onchange={onGpxPick}
    aria-label="Import GPX into library"
  />

  {#if routes.length === 0}
    <!-- EMPTY STATE: honest, and one tap from the importer -->
    <div
      class="rounded-card border border-dashed border-hairline-strong bg-surface p-6 flex flex-col items-center text-center gap-3 elevation-card"
    >
      <div class="grid h-14 w-14 place-items-center rounded-pill bg-tile border border-hairline text-crimson-deep">
        <Icon name="map" size={24} strokeWidth={1.5} />
      </div>
      <div class="flex flex-col gap-1">
        <h2 class="text-base font-extrabold tracking-tight text-ink">No saved routes yet</h2>
        <p class="text-[13px] text-ink-dim leading-relaxed max-w-[32ch]">
          Tap import — every GPX you add lands here, ready to preview again.
        </p>
      </div>
      <button
        type="button"
        class="h-11 px-5 rounded-pill bg-crimson-fill text-white text-[11px] font-extrabold uppercase tracking-wider flex items-center gap-2 glow-signal active:scale-[0.98] transition-transform"
        onclick={() => fileInput?.click()}
      >
        <Icon name="file-up" size={16} strokeWidth={2} />
        Import a GPX
      </button>
    </div>
  {:else}
    <div class="flex flex-col gap-2.5">
      {#each routes as r (r.id)}
        <div class="rounded-card bg-surface border border-hairline p-1.5 pr-2.5 flex items-center gap-1 elevation-card">
          <a
            href="#/routes/{r.id}"
            class="flex flex-1 min-w-0 items-center gap-3 rounded-2xl p-1.5 transition-colors hover:bg-tile/60"
            aria-label="Preview {r.name}"
            title="Preview route"
          >
            <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-tile border border-hairline text-signal">
              <Icon name="route" size={19} strokeWidth={1.6} />
            </span>
            <span class="flex min-w-0 flex-1 flex-col leading-tight">
              <span class="truncate text-[13px] font-bold text-ink">{r.name}</span>
              <span class="truncate text-[11px] text-ink-dim text-tabular">
                {formatDistance(r.distanceKm, unit)} · {formatElevation(r.elevGainM, unit)} · {fmtDate(r.createdAt)}
              </span>
            </span>
            <Icon
              name="chevron-right"
              size={16}
              strokeWidth={1.8}
              class="shrink-0 text-ink-dim"
            />
          </a>
          <button
            type="button"
            class="grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition-colors {confirmId === r.id
              ? 'bg-kritis/10 border-kritis/50 text-kritis'
              : 'bg-tile border-hairline text-ink-dim hover:text-kritis hover:border-hairline-strong'}"
            title={confirmId === r.id ? 'Tap again to confirm' : 'Delete route'}
            aria-label={confirmId === r.id
              ? `Confirm deleting ${r.name}`
              : `Delete ${r.name}`}
            onclick={() => void remove(r.id, r.name)}
          >
            <Icon name="trash-2" size={15} strokeWidth={1.8} />
          </button>
        </div>
      {/each}
    </div>

    <p class="text-[11px] text-ink-dim text-center -mt-1">
      Deleting removes the stored track from this device only — your GPX file stays where you saved it.
    </p>
  {/if}
</div>
