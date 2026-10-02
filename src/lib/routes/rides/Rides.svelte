<script lang="ts">
  import EditorialHeader from '$lib/components/EditorialHeader.svelte';
  import CircleButton from '$lib/components/CircleButton.svelte';
  import Sparkline from '$lib/components/Sparkline.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import { recentActivities, allActivities, computeWeek, activeBike, powerCurves } from '$lib/data/queries.svelte';
  import { route } from '$lib/router.svelte';
  import { db, type Activity } from '$lib/data/db';
  import { newId } from '$lib/data/seed';
  import { decimateTrack, parseCourse } from '$lib/domain/course';
  import { deflateJson, extractPower } from '$lib/data/streams';
  import { ftpOnDate, rideMetrics, METRICS_VERSION } from '$lib/domain/metrics';
  import { distanceUnit, formatDistance, formatElevation, type UnitSystem } from '$lib/domain/units';
  import { appSettings } from '$lib/data/queries.svelte';
  import { CheckCircle2, LoaderCircle, X } from '@lucide/svelte';

  type Filter = 'all' | 'rides' | 'commutes' | 'power';
  let filter = $state<Filter>('all');
  let query = $state('');
  let searchOpen = $state(false);
  let importInput: HTMLInputElement | null = $state(null);
  let importing = $state(false);
  let toast: string | null = $state(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function showToast(msg: string): void {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 3400);
  }

  const filtered = $derived.by<Activity[]>(() => {
    let items = recentActivities.current ?? [];
    if (filter === 'commutes') items = items.filter((a) => a.commute);
    else if (filter === 'power') items = items.filter((a) => a.np != null);
    else if (filter === 'rides') items = items.filter((a) => !a.commute);
    const q = query.trim().toLowerCase();
    if (q) items = items.filter((a) => a.name.toLowerCase().includes(q));
    return items;
  });

  // real mean-max curve per ride (M2) — replaces the decorative sparkline
  const curveByActivity = $derived.by(() => {
    const map = new Map<string, number[]>();
    for (const row of powerCurves.current ?? []) map.set(row.activityId, row.points.map((p) => p.watts));
    return map;
  });

  /** Decimate a real curve to `n` points for the list sparkline. */
  function curveSpark(a: Activity): number[] {
    const pts = curveByActivity.get(a.id);
    if (!pts || pts.length < 2) return [];
    const step = (pts.length - 1) / 11;
    return Array.from({ length: 12 }, (_, i) => pts[Math.round(i * step)]);
  }

  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function fmtDur(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }

  const month = $derived(computeWeek(allActivities.current ?? []));
  const unit = $derived<UnitSystem>(appSettings.current?.unit ?? 'metric');

  // ---------- GPX/TCX import (PRD F1-AC1) ----------
  // The parser and the stream codec live in the domain/data layers so they can be
  // unit-tested; this component only owns file picking and the DB transaction.

  async function importFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    importing = true;
    const bike = activeBike.current?.bike;
    let ok = 0;
    try {
      for (const file of files) {
        try {
          const ride = parseCourse(await file.text(), file.name);
          // Decimation bounds storage, and now also thins the power trace: a 4 h ride
          // lands at roughly 3 s sampling, still well inside the 30 s NP window.
          const points = decimateTrack(ride.points, 6000);
          const id = newId();

          // A TCX from a head unit carries watts at every trackpoint, and a Garmin GPX
          // carries the same as a TrackPointExtension. `parseCourse` used to discard
          // both, so every imported ride arrived with no power and no NP/TSS — and the
          // honest empty state covered for it so convincingly that the loss was
          // invisible. Score the ride from its own trace instead (ARCHITECTURE §5.1).
          const trace = extractPower(points);
          const ftp = ftpOnDate(await db.ftp_history.orderBy('date').toArray(), ride.dateIso);
          const m = trace ? rideMetrics(trace.watts, ftp, trace.sampleSec, ride.movingSec) : null;

          const act: Activity = {
            id,
            date: ride.dateIso,
            name: ride.name,
            source: ride.source,
            bikeId: bike?.id,
            distanceKm: ride.distanceKm,
            movingSec: ride.movingSec,
            elapsedSec: ride.movingSec,
            elevGainM: ride.elevGainM,
            avgPower: m?.avgPower,
            np: m ? Math.round(m.np) : undefined,
            // IF and TSS need an FTP to divide by. Without one they are left absent
            // rather than written as 0, which would read as "rode at zero intensity".
            if: ftp > 0 && m ? Math.round(m.if * 100) / 100 : undefined,
            tss: ftp > 0 && m ? Math.round(m.tss) : undefined,
            // Real energy from the trace when we have one; the crude per-km estimate
            // is only for files that genuinely carry no meter.
            kcal: m ? Math.round(m.kcal) : Math.round(ride.distanceKm * 26),
            mVersion: m ? METRICS_VERSION : undefined,
            updatedAt: Date.now()
          };
          const compressed = await deflateJson(points);
          await db.transaction('rw', [db.activities, db.activity_streams, db.bikes], async () => {
            await db.activities.put(act);
            await db.activity_streams.put({
              id,
              compressed,
              // Union, not the first sample's keys: a sensor paired halfway through the
              // ride leaves the opening points without watts, and trusting point[0]
              // would hide the field the decoder needs to find.
              fields: [...new Set(points.flatMap((p) => Object.keys(p)))],
              source: ride.source,
              updatedAt: Date.now()
            });
            // F3-AC2: import dengan sepeda aktif menambah odometer sepeda tersebut
            if (bike) {
              const b = await db.bikes.get(bike.id);
              if (b) await db.bikes.update(b.id, { odometerKm: b.odometerKm + ride.distanceKm, updatedAt: Date.now() });
            }
          });
          ok++;
        } catch (err) {
          console.error('[gowslab] import failed:', file.name, err);
        }
      }
      showToast(
        ok > 0 ? `${ok} ride${ok > 1 ? 's' : ''} imported — odometer updated` : 'Import failed — check the file format'
      );
    } finally {
      importing = false;
      if (importInput) importInput.value = '';
    }
  }

  function onImportPick(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    void importFiles([...(input.files ?? [])]);
  }
</script>

<div class="mx-auto max-w-md px-5 pt-8 space-y-5">
  <EditorialHeader kicker="Your rides" headline="Every watt counts" sub="From the last import —" accent="and the archive.">
    <CircleButton icon="search" label="Search rides" active={searchOpen} onclick={() => (searchOpen = !searchOpen)} />
    <CircleButton icon="file-up" label="Import GPX/TCX/FIT" onclick={() => importInput?.click()} />
  </EditorialHeader>

  <input
    bind:this={importInput}
    class="hidden"
    type="file"
    accept=".gpx,.tcx"
    multiple
    onchange={onImportPick}
    aria-label="Import GPX or TCX files"
  />

  {#if searchOpen}
    <div class="h-11 rounded-pill bg-surface border border-hairline flex items-center px-4 elevation-card">
      <input
        class="w-full bg-transparent text-sm font-semibold text-ink placeholder-ink-dim/60 outline-none"
        type="search"
        placeholder="Search ride name…"
        bind:value={query}
      />
      {#if query}
        <button class="text-ink-dim hover:text-ink" onclick={() => (query = '')} aria-label="Clear search">
          <X size={16} strokeWidth={1.8} />
        </button>
      {/if}
    </div>
  {/if}

  <!--
    One rhythm, three figures, one action.

    The right-hand side used to be "5.8h · 313 TSS" — two different measurements joined by a
    middot with no labels, sitting on the same line as a settings button. So the primary
    number had a label and a large figure while its peers were an unlabelled run-on string
    at 11px, and the three items were not on a shared baseline: the text started 19px below
    the primary's label.

    Hours and TSS are now label + figure pairs with the same rhythm as the primary, which is
    the pattern the dashboard hero already uses. The button stays last and stays a button:
    it is an action, and dressing it as data was part of what made the row read as one
    undifferentiated block.
  -->
  <div class="flex items-end justify-between gap-3 rounded-card bg-mono text-on-mono glow-mono bg-mono-gradient p-5">
    <div class="flex flex-col">
      <span class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">This week</span>
      <span class="block text-metric-lg text-tabular font-extrabold leading-tight">
        {formatDistance(month.km, unit, 0).split(' ')[0]}<span class="text-sm text-on-mono-dim font-semibold ml-1.5">{distanceUnit(unit)}</span>
      </span>
    </div>
    <div class="flex items-end gap-3.5">
      <div class="flex flex-col items-end">
        <span class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">Time</span>
        <span class="text-base font-extrabold text-on-mono text-tabular leading-tight">{month.hours}h</span>
      </div>
      <div class="flex flex-col items-end">
        <span class="text-[10px] font-bold uppercase tracking-wider text-on-mono-dim">Stress</span>
        <span class="text-base font-extrabold text-rose text-tabular leading-tight">{month.tss}</span>
      </div>
      <CircleButton icon="refresh-cw" label="Strava sync status & settings" onclick={() => route.navigate('settings')} />
    </div>
  </div>

  <div class="flex gap-2 overflow-x-auto scrollbar-none">
    {#each [['all', 'All'], ['rides', 'Rides'], ['commutes', 'Commutes'], ['power', 'With power']] as [key, label] (key)}
      <button
        class="h-8 shrink-0 rounded-pill px-4 text-xs font-bold uppercase tracking-wide transition-colors {filter === key
          ? 'bg-mono text-on-mono'
          : 'bg-surface text-ink-dim border border-hairline hover:text-ink elevation-card'}"
        onclick={() => (filter = key as Filter)}
      >
        {label}
      </button>
    {/each}
  </div>

  {#if recentActivities.ready && filtered.length === 0}
    <div class="rounded-card border border-dashed border-hairline-strong p-8 text-center space-y-2">
      <span class="kicker block">{query ? 'No rides match your search' : 'No rides here yet'}</span>
      <p class="text-sm text-ink-dim">Import GPX/TCX or sync from Strava.</p>
    </div>
  {:else}
    <ul class="space-y-2.5">
      {#each filtered as a (a.id)}
        <li>
          <a
            href="#/rides/{encodeURIComponent(a.id)}"
            class="flex items-center gap-3 rounded-card bg-surface border border-hairline p-3.5 elevation-card hover:border-hairline-strong transition-colors"
            aria-label="Open ride detail — {a.name}"
          >
            <div class="relative shrink-0">
              <div class="grid h-11 w-11 place-items-center rounded-pill bg-tile border border-hairline text-ink">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="m12 17.5 3-9 3 5.5"/><path d="M15 8.5h-5l-2 5.5"/><path d="m8 17.5 5-9"/></svg>
              </div>
              <span class="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-pill bg-tile border border-hairline px-1.5 text-[9px] font-bold uppercase tracking-wider text-ink-dim">
                {a.source}
              </span>
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-bold">{a.name}</p>
              <p class="text-xs text-ink-dim">
                {fmtDate(a.date)} · {formatDistance(a.distanceKm, unit)} · {formatElevation(a.elevGainM, unit)} ↑ · {fmtDur(a.movingSec)}
              </p>
            </div>
            <div class="shrink-0 text-right">
              <p class="text-metric-md text-tabular">{a.tss ?? '—'}</p>
              <p class="text-[11px] font-semibold text-ink-dim">IF {a.if?.toFixed(2) ?? '—'}</p>
              {#if curveSpark(a).length > 1}
                <div class="mt-1 opacity-90" title="Mean maximal power curve for this ride">
                  <Sparkline points={curveSpark(a)} width={64} height={18} ariaLabel="Ride power curve" />
                </div>
              {/if}
            </div>
          </a>
        </li>
      {/each}
    </ul>
  {/if}

  <p class="pt-2 text-center">
    <StatusChip label="Local-first · no cloud needed" status="neutral" />
  </p>
</div>

{#if toast || importing}
  <div class="fixed inset-x-0 bottom-[calc(88px+env(safe-area-inset-bottom,0px)+8px)] z-[55] mx-auto max-w-md px-5">
    <div class="flex items-center justify-center gap-2 rounded-pill bg-mono text-on-mono px-4 py-2.5 elevation-raised">
      {#if importing}
        <LoaderCircle size={15} strokeWidth={2} class="animate-spin text-rose" />
        <span class="text-[11px] font-bold uppercase tracking-wider">Parsing files…</span>
      {:else}
        <CheckCircle2 size={15} strokeWidth={2} class="text-aman" />
        <span class="text-[11px] font-bold uppercase tracking-wider">{toast}</span>
      {/if}
    </div>
  </div>
{/if}
