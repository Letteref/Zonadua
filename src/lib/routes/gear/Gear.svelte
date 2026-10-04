<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import EditorialHeader from '$lib/components/EditorialHeader.svelte';
  import HatchTrack from '$lib/components/HatchTrack.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import { allBikesWithComponents, appSettings, computeWear, type ComponentWear } from '$lib/data/queries.svelte';
  import { convertDistance, distanceUnit, type UnitSystem } from '$lib/domain/units';
  import { db, type BikeComponent, type Bike } from '$lib/data/db';
  import { newId } from '$lib/data/seed';
  import { toast } from '$lib/toast.svelte';
  
  const bikes = $derived(allBikesWithComponents.current ?? []);

  // Primary bike first, then the rest
  const ordered = $derived([...bikes].sort((a, b) => Number(b.bike.active) - Number(a.bike.active)));
  const primary = $derived(ordered.find((b) => b.bike.active));
  const primaryId = $derived(primary?.bike.id);

  const summary = $derived.by(() => {
    let odo = 0;
    let due = 0;
    for (const { bike, components } of bikes) {
      odo += bike.odometerKm;
      for (const c of components) {
        if (computeWear(c, bike.odometerKm).status !== 'aman') due++;
      }
    }
    return { odo, due };
  });

  const wearOf = (components: BikeComponent[], odoKm: number): ComponentWear[] =>
    components.map((c) => computeWear(c, odoKm)).sort((a, b) => b.pct - a.pct);

  const typeLabel: Record<string, string> = { road: 'Road', gravel: 'Gravel', mtb: 'MTB' };
  const unit = $derived<UnitSystem>(appSettings.current?.unit ?? 'metric');
  /** odometer values are stored in km; convert only for display */
  const fmtDist = $derived((km: number) => Math.round(convertDistance(km, unit)).toLocaleString('en-US'));
  const distLabel = $derived(distanceUnit(unit));

  // ---------- add / edit form (bottom sheet) ----------
  let sheetOpen = $state(false);
  let sheetBikeId = $state<string | null>(null);
  let editing = $state<BikeComponent | null>(null);
  let cName = $state('');
  let cKind = $state('chain');
  let cInstalled = $state(0);
  let cInterval = $state(4000);

  const KINDS = ['chain', 'brake-pads', 'tires', 'cassette', 'chainring', 'cable-housing', 'bar-tape'];

  function openAdd(bikeId: string): void {
    const bike = bikes.find((b) => b.bike.id === bikeId);
    editing = null;
    sheetBikeId = bikeId;
    cName = '';
    cKind = 'chain';
    cInstalled = bike?.bike.odometerKm ?? 0;
    cInterval = 4000;
    sheetOpen = true;
  }

  function openEdit(comp: BikeComponent): void {
    editing = comp;
    sheetBikeId = comp.bikeId;
    cName = comp.name;
    cKind = comp.kind;
    cInstalled = comp.installedAtOdoKm;
    cInterval = comp.intervalKm;
    sheetOpen = true;
  }

  async function saveComponent(): Promise<void> {
    if (!sheetBikeId || !cName.trim() || cInterval <= 0) return;
    const rec: BikeComponent = {
      id: editing?.id ?? newId(),
      bikeId: sheetBikeId,
      name: cName.trim(),
      kind: cKind,
      installedAtOdoKm: Math.max(0, Math.round(cInstalled)),
      intervalKm: Math.round(cInterval),
      notes: editing?.notes,
      updatedAt: Date.now()
    };
    try {
      // plain object only: Dexie/IndexedDB cannot structured-clone $state proxies
      await db.components.put(rec);
    } catch (err) {
      // the sheet stays open on purpose: closing it after a failed write makes the
      // component look saved, and the rider's typed values are gone with it
      console.error('[zonadua] saveComponent failed:', err);
      toast.error(`Could not save ${rec.name}`);
      return;
    }
    sheetOpen = false;
    toast.ok(`${rec.name} saved`);
  }

  // ---------- service: wear clock resets at the current odometer ----------
  async function service(comp: BikeComponent, odoKm: number): Promise<void> {
    try {
      await db.components.update(comp.id, { installedAtOdoKm: odoKm, updatedAt: Date.now() });
      toast.ok(`${comp.name} serviced`);
    } catch (err) {
      console.error('[zonadua] service failed:', err);
      // the wear bar is derived from the stored odometer, so a silent failure here
      // leaves a serviced part counting up to its next due service anyway
      toast.error(`Could not service ${comp.name}`);
    }
  }

  // ---------- delete with two-step confirm ----------
  let confirmId = $state<string | null>(null);
  async function remove(comp: BikeComponent): Promise<void> {
    if (confirmId !== comp.id) {
      confirmId = comp.id;
      return;
    }
    try {
      await db.components.delete(comp.id);
      toast.ok(`${comp.name} deleted`);
    } catch (err) {
      console.error('[zonadua] remove failed:', err);
      // the row is still there: without this the part silently stays and the rider
      // assumes the delete worked
      toast.error(`Could not delete ${comp.name}`);
    }
    confirmId = null;
  }

  // ---------- set active bike (exactly one active) ----------
  async function setActive(bike: Bike): Promise<void> {
    if (bike.active) return;
    try {
      await db.transaction('rw', db.bikes, async () => {
        const all = await db.bikes.toArray();
        for (const b of all) {
          if (b.active !== (b.id === bike.id)) {
            await db.bikes.update(b.id, { active: b.id === bike.id, updatedAt: Date.now() });
          }
        }
      });
    } catch (err) {
      console.error('[zonadua] setActive failed:', err);
      // the transaction is all-or-nothing, so the old bike is still the active one —
      // saying so beats a header that keeps showing the bike the rider just switched off
      toast.error(`Could not switch to ${bike.name}`);
    }
  }
</script>

<div class="mx-auto max-w-md px-5 pt-8 pb-10 flex flex-col gap-5">
  <EditorialHeader
    kicker="Bikes & gear"
    headline="The stable"
    sub={ordered.length === 0 ? 'No machines yet —' : ordered.length === 1 ? 'One machine on rotation —' : `${ordered.length} machines on rotation —`}
    accent="wear tracked by odometer."
  />

  {#if primary}
    <!-- PRIMARY BIKE — ember-lit monolith, pinned right under the header -->
    <section class="rounded-card bg-mono text-on-mono glow-mono bg-mono-gradient p-5 flex flex-col gap-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-[10px] font-bold uppercase tracking-[0.12em] text-on-mono-dim">Primary bike</p>
          <h2 class="text-[22px] font-extrabold tracking-tight mt-1 truncate">{primary.bike.name}</h2>
          <p class="text-xs text-on-mono-dim mt-0.5">
            {typeLabel[primary.bike.type] ?? primary.bike.type} · {primary.bike.weightKg} kg
          </p>
        </div>
        <span
          class="shrink-0 text-[9px] font-extrabold uppercase tracking-wider text-rose border border-[rgba(255,77,94,0.45)] bg-[rgba(232,16,46,0.2)] rounded-pill px-2.5 py-1"
        >
          Active
        </span>
      </div>
      <div class="flex items-end justify-between gap-3 border-t border-[#2b2d33] pt-4">
        <div>
          <p class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">Odometer</p>
          <p class="text-[34px] leading-none font-extrabold text-tabular tracking-tight mt-1">
            {fmtDist(primary.bike.odometerKm)}<span class="text-base font-bold text-on-mono-dim ml-1.5">{distLabel}</span>
          </p>
        </div>
        {#if primary.bike.notes}
          <p class="text-[10.5px] text-on-mono-dim text-right max-w-[46%] leading-relaxed">{primary.bike.notes}</p>
        {/if}
      </div>
    </section>
  {/if}

  <!-- SUMMARY — three left-aligned columns, even gutters -->
  <div class="rounded-card bg-surface border border-hairline elevation-card px-5 py-4">
    <div class="grid grid-cols-3 divide-x divide-hairline">
      <div class="flex flex-col gap-1.5 pr-3 min-w-0">
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Bikes</span>
        <span class="text-xl font-extrabold text-tabular tracking-tight leading-none">{bikes.length}</span>
      </div>
      <div class="flex flex-col gap-1.5 px-3 min-w-0">
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim whitespace-nowrap">Distance</span>
        <span class="text-xl font-extrabold text-tabular tracking-tight leading-none whitespace-nowrap">
          {fmtDist(summary.odo)}<span class="text-[11px] text-ink-dim font-bold ml-1">{distLabel}</span>
        </span>
      </div>
      <div class="flex flex-col gap-1.5 pl-3 min-w-0">
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim whitespace-nowrap">Due soon</span>
        <span
          class="text-xl font-extrabold text-tabular tracking-tight leading-none {summary.due > 0
            ? 'text-crimson-deep'
            : ''}"
        >
          {summary.due}
        </span>
      </div>
    </div>
  </div>

  {#each ordered as { bike, components } (bike.id)}
    {#if bike.id !== primaryId}
      <!-- SECONDARY BIKE — clean card -->
      <section class="rounded-card bg-surface border border-hairline elevation-card p-4 flex flex-col gap-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-base font-extrabold tracking-tight truncate">{bike.name}</h2>
            <p class="text-xs text-ink-dim mt-0.5">{typeLabel[bike.type] ?? bike.type} · {bike.weightKg} kg</p>
          </div>
          <StatusChip label="Standby" status="neutral" />
        </div>
        <div class="flex items-end justify-between gap-3">
          <p class="text-metric-md text-tabular font-extrabold">
            {fmtDist(bike.odometerKm)}<span class="text-xs text-ink-dim font-semibold ml-1">{distLabel}</span>
          </p>
          {#if bike.notes}
            <p class="text-[10.5px] text-ink-dim text-right max-w-[52%] leading-relaxed">{bike.notes}</p>
          {/if}
        </div>
        <button
          class="mt-1 h-9 w-full rounded-pill bg-tile border border-hairline-strong text-[10px] font-extrabold uppercase tracking-wider text-ink flex items-center justify-center gap-1.5 hover:border-ink active:scale-[0.98] transition-all"
          onclick={() => setActive(bike)}
        >
          <Icon name="check" size={14} strokeWidth={2.2} />
          Set as active bike
        </button>
      </section>
    {/if}

    <!-- COMPONENTS + WEAR -->
    <section class="flex flex-col gap-2.5">
      <div class="flex items-center justify-between">
        <span class="kicker">Components · {bike.name}</span>
        <button
          class="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-crimson-deep bg-surface border border-hairline rounded-pill px-2.5 py-1 hover:border-hairline-strong transition-colors"
          onclick={() => openAdd(bike.id)}
        >
          <Icon name="plus" size={13} strokeWidth={2.4} />
          Add
        </button>
      </div>

      {#if components.length > 0}
        <div class="rounded-card bg-surface border border-hairline elevation-card divide-y divide-hairline">
          {#each wearOf(components, bike.odometerKm) as w (w.comp.id)}
            <div class="p-4 flex flex-col gap-2.5">
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="grid h-9 w-9 place-items-center rounded-pill bg-tile border border-hairline text-ink-dim shrink-0">
                    <Icon name="wrench" size={17} strokeWidth={1.5} />
                  </div>
                  <div class="min-w-0">
                    <p class="text-sm font-bold tracking-tight truncate">{w.comp.name}</p>
                    <p class="text-[11px] text-ink-dim text-tabular">
                      {fmtDist(w.usedKm)} / {fmtDist(w.comp.intervalKm)} {distLabel}
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <span
                    class="text-[11px] font-bold text-tabular {w.status === 'aman'
                      ? 'text-ink-dim'
                      : w.status === 'waspada'
                        ? 'text-warn'
                        : 'text-kritis'}"
                  >
                    {Math.round(w.pct * 100)}%
                  </span>
                  <StatusChip
                    label={w.status}
                    status={w.status}
                    icon={w.status === 'kritis' ? 'alert' : w.status === 'waspada' ? 'warn' : 'check'}
                  />
                </div>
              </div>
              <HatchTrack pct={w.pct} status={w.status} />
              {#if confirmId === w.comp.id}
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[10.5px] font-bold text-kritis">Delete “{w.comp.name}”?</span>
                  <div class="flex items-center gap-1.5">
                    <button
                      class="h-7 px-2.5 rounded-lg bg-kritis text-white grid place-items-center text-[10px] font-extrabold uppercase tracking-wider"
                      onclick={() => remove(w.comp)}
                    >
                      <Icon name="check" size={13} strokeWidth={2.4} />
                    </button>
                    <button
                      class="h-7 px-2.5 rounded-lg bg-tile border border-hairline grid place-items-center text-ink-dim"
                      onclick={() => (confirmId = null)}
                      aria-label="Cancel delete"
                    >
                      <Icon name="x" size={13} strokeWidth={2} />
                    </button>
                  </div>
                </div>
              {:else}
                <div class="flex items-center justify-between">
                  <span class="text-[10px] text-ink-dim text-tabular">Installed at {fmtDist(w.comp.installedAtOdoKm)} {distLabel}</span>
                  <div class="flex items-center gap-1.5">
                    <button
                      class="grid h-7 w-7 place-items-center rounded-lg bg-tile border border-hairline text-ink-dim hover:text-crimson-deep hover:border-hairline-strong transition-colors"
                      title="Service done — reset wear at current odometer"
                      aria-label="Service {w.comp.name}"
                      onclick={() => service(w.comp, bike.odometerKm)}
                    >
                      <Icon name="rotate-ccw" size={14} strokeWidth={1.8} />
                    </button>
                    <button
                      class="grid h-7 w-7 place-items-center rounded-lg bg-tile border border-hairline text-ink-dim hover:text-ink hover:border-hairline-strong transition-colors"
                      title="Edit component"
                      aria-label="Edit {w.comp.name}"
                      onclick={() => openEdit(w.comp)}
                    >
                      <Icon name="pencil" size={14} strokeWidth={1.8} />
                    </button>
                    <button
                      class="grid h-7 w-7 place-items-center rounded-lg bg-tile border border-hairline text-ink-dim hover:text-kritis hover:border-hairline-strong transition-colors"
                      title="Delete component"
                      aria-label="Delete {w.comp.name}"
                      onclick={() => remove(w.comp)}
                    >
                      <Icon name="trash-2" size={14} strokeWidth={1.8} />
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div class="rounded-card border border-dashed border-hairline-strong p-5 text-center flex flex-col items-center gap-3">
          <p class="text-sm text-ink-dim">No components tracked on this bike yet.</p>
          <button
            class="h-9 px-4 rounded-pill bg-ink text-on-mono text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 active:scale-[0.98] transition-transform"
            onclick={() => openAdd(bike.id)}
          >
            <Icon name="plus" size={14} strokeWidth={2.4} />
            Add first component
          </button>
        </div>
      {/if}
    </section>
  {/each}

  <p class="text-center text-xs text-ink-dim">
    Wear model: WASPADA ≥ 90%, KRITIS ≥ 100% · ⟳ logs a service at the current odometer — all changes persist locally.
  </p>
</div>

{#if sheetOpen}
  <!-- backdrop -->
  <button
    class="fixed inset-0 z-[60] bg-ink/40 backdrop-blur-[2px]"
    aria-label="Close form"
    onclick={() => (sheetOpen = false)}
  ></button>

  <!-- bottom sheet form -->
  <div
    class="fixed inset-x-0 bottom-0 z-[70] mx-auto max-w-md rounded-t-[28px] bg-surface border-t border-hairline elevation-raised p-5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] flex flex-col gap-4"
    role="dialog"
    aria-modal="true"
    aria-label={editing ? 'Edit component' : 'Add component'}
  >
    <div class="flex items-center justify-between">
      <h2 class="text-base font-extrabold tracking-tight">{editing ? 'Edit component' : 'Add component'}</h2>
      <button
        class="grid h-8 w-8 place-items-center rounded-pill bg-tile border border-hairline text-ink-dim hover:text-ink transition-colors"
        onclick={() => (sheetOpen = false)}
        aria-label="Close"
      >
        <Icon name="x" size={16} strokeWidth={1.8} />
      </button>
    </div>

    <label class="flex flex-col gap-1.5">
      <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Name</span>
      <input
        class="h-11 rounded-2xl bg-tile border border-hairline px-3.5 text-sm font-bold text-ink outline-none focus:border-signal transition-colors"
        type="text"
        bind:value={cName}
        placeholder="e.g. Chain, GP5000 Tires"
      />
    </label>

    <div class="flex flex-col gap-1.5">
      <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Kind</span>
      <div class="flex flex-wrap gap-1.5">
        {#each KINDS as k (k)}
          <button
            class="h-8 px-3 rounded-pill text-[11px] font-bold border transition-colors {cKind === k
              ? 'bg-ink text-on-mono border-ink'
              : 'bg-tile text-ink-dim border-hairline hover:text-ink'}"
            onclick={() => (cKind = k)}
          >
            {k}
          </button>
        {/each}
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <label class="flex flex-col gap-1.5">
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Installed at (km)</span>
        <input
          class="h-11 rounded-2xl bg-tile border border-hairline px-3.5 text-sm font-bold text-ink text-tabular outline-none focus:border-signal transition-colors"
          type="number"
          min="0"
          step="1"
          bind:value={cInstalled}
        />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Interval (km)</span>
        <input
          class="h-11 rounded-2xl bg-tile border border-hairline px-3.5 text-sm font-bold text-ink text-tabular outline-none focus:border-signal transition-colors"
          type="number"
          min="100"
          step="100"
          bind:value={cInterval}
        />
      </label>
    </div>

    <button
      class="h-12 rounded-pill bg-crimson-fill text-white font-extrabold uppercase text-[11px] tracking-wider glow-signal active:scale-[0.98] transition-transform flex items-center justify-center gap-2 disabled:opacity-40"
      disabled={!cName.trim() || cInterval <= 0}
      onclick={saveComponent}
    >
      <Icon name="check" size={16} strokeWidth={2.4} />
      {editing ? 'Save changes' : 'Add component'}
    </button>
  </div>
{/if}
