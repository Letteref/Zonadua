<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import EditorialHeader from '$lib/components/EditorialHeader.svelte';
  import CircleButton from '$lib/components/CircleButton.svelte';
  import Sparkline from '$lib/components/Sparkline.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import SyncHint from '$lib/components/SyncHint.svelte';
  import { recentActivities, allActivities, computeWeek, activeBike, powerCurves, appSettings, syncState } from '$lib/data/queries.svelte';
  import { route } from '$lib/router.svelte';
  import { db, activityProvenance, isCyclingActivity, type Activity } from '$lib/data/db';
  import { newId } from '$lib/data/seed';
  import { decimateTrack, parseCourse } from '$lib/domain/course';
  import { isFitFile, parseFit, fitToCourse } from '$lib/domain/fit';
  import { deflateJson, extractPower } from '$lib/data/streams';
  import { ftpOnDate, rideMetrics, estimateRideMetrics, METRICS_VERSION } from '$lib/domain/metrics';
  import { distanceUnit, formatDistance, formatElevation, type UnitSystem } from '$lib/domain/units';
  import { runLiveSync } from '$lib/infra/strava/runSync';
  import { AUTO_SYNC_FLAG, AUTO_SYNC_IN_FLIGHT } from '$lib/infra/strava/autoSync';
  import { toast } from '$lib/toast.svelte';

  /** the global pill (UI-SPEC §46); this route only picks the words */
  const showToast = (msg: string): void => toast.ok(msg);

  type Filter = 'all' | 'rides' | 'commutes' | 'power';
  let filter = $state<Filter>('all');
  let query = $state('');
  let importInput: HTMLInputElement | null = $state(null);
  let syncing = $state(false);

  /**
   * Strava is the primary pipeline, so the header's primary action follows the connection:
   * connected → one tap re-syncs right here; not connected → the button opens Settings,
   * where the Connect flow lives. File import stays available next to the empty state.
   */
  const connected = $derived(Boolean(syncState.current?.accessToken));

  async function onSyncNow(): Promise<void> {
    if (syncing) return;
    syncing = true;
    try {
      // Mark this tab's session so the boot gate's cooldown and in-flight rules see it.
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(AUTO_SYNC_FLAG, AUTO_SYNC_IN_FLIGHT);
      const r = await runLiveSync();
      if (r.reason === 'not_connected') {
        showToast('Strava is not connected — open Settings to connect');
      } else if (r.reason === 'rate_limited') {
        showToast("Stopped at Strava's rate-limit guard — resumes shortly");
      } else if (r.reason) {
        showToast('Strava sync failed — see Settings for details');
      } else {
        const traces = r.streamsFetched + r.streamsBackfilled;
        showToast(
          r.pulled > 0
            ? `Pulled ${r.pulled} ride${r.pulled === 1 ? '' : 's'} from Strava${traces > 0 ? ` · ${traces} trace${traces === 1 ? '' : 's'}` : ''}`
            : 'Strava is up to date — nothing new upstream'
        );
      }
    } catch {
      showToast('Strava sync failed — try again when the network is back');
    } finally {
      // Stamp the cooldown so a boot right after a manual sync does not immediately re-run
      // one; the boot gate reads this same marker.
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(AUTO_SYNC_FLAG, String(Date.now()));
      syncing = false;
    }
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

  /**
   * All-time totals, over every *riding* activity on the device — pulled, imported or both.
   * Walks and runs a Strava sync pulled are excluded: real activity, but not riding.
   *
   * The week figures above are the planning window, and on a device whose rides are a few
   * days old they read as zero, which is true and useless at the same time: the log was not
   * empty, it simply held nothing from this week. These four numbers are what answers
   * "how much is actually in here", and they are computed from the same rows the list below
   * renders, so they cannot disagree with it.
   */
  const lifetime = $derived.by(() => {
    const acts = (allActivities.current ?? []).filter(isCyclingActivity);
    return {
      rides: acts.length,
      km: acts.reduce((s, a) => s + (a.distanceKm || 0), 0),
      hours: Math.round(acts.reduce((s, a) => s + (a.movingSec || 0), 0) / 3600),
      elev: acts.reduce((s, a) => s + (a.elevGainM || 0), 0)
    };
  });
  const unit = $derived<UnitSystem>(appSettings.current?.unit ?? 'metric');

  // ---------- GPX/TCX import (PRD F1-AC1) ----------
  // The parser and the stream codec live in the domain/data layers so they can be
  // unit-tested; this component only owns file picking and the DB transaction.

  async function importFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    // sticky: a spinner that dismisses itself mid-parse tells the rider it finished
    toast.busy('Parsing files…');
    const bike = activeBike.current?.bike;
    let ok = 0;
    let failed = 0;
    try {
      for (const file of files) {
        try {
          // FIT is binary, so it is sniffed by magic bytes before the XML parsers see it.
          const bytes = new Uint8Array(await file.arrayBuffer());
          const ride = isFitFile(bytes)
            ? fitToCourse(parseFit(bytes, file.name))
            : parseCourse(await file.text(), file.name);
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
          // No meter on the file? Score load from speed + elevation so PMC is not empty
          // while the rider waits for power data — and mark it, so no surface can pass
          // a modelled number off as measured (ARCHITECTURE §5.1: honest provenance).
          const est = !m && ftp > 0 ? estimateRideMetrics(ride.distanceKm, ride.elevGainM, ride.movingSec, ftp) : null;

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
            if: ftp > 0 && m ? Math.round(m.if * 100) / 100 : est ? est.if : undefined,
            tss: ftp > 0 && m ? Math.round(m.tss) : est ? est.tss : undefined,
            tssEstimated: est ? true : undefined,
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
          failed++;
          console.error('[zonadua] import failed:', file.name, err);
        }
      }
      // a mixed batch says so: "2 rides imported" over three picked files is a lie the
      // rider cannot act on, so the count that failed is part of the message
      if (ok > 0 && failed === 0) {
        showToast(`${ok} ride${ok > 1 ? 's' : ''} imported — odometer updated`);
      } else if (ok > 0) {
        toast.error(`${ok} imported, ${failed} failed — check the file format`);
      } else {
        toast.error('Import failed — check the file format');
      }
    } finally {
      if (importInput) importInput.value = '';
    }
  }

  function onImportPick(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    void importFiles([...(input.files ?? [])]);
  }
</script>

<div class="mx-auto max-w-md px-5 pt-8 space-y-5">
  <!--
    The search button used to sit in the header slot, next to the import button, and it
    cost the headline more width than it could spare — "EVERY WATT COUNTS" was being
    clipped by a 44 px circle. Search is not a header action anyway: it is a way of
    narrowing the list below, so it belongs next to the list. It now sits under the
    "This week" hero, always visible rather than behind a toggle, which also removes the
    second click that the old design asked for before you could type anything.
  -->
  <EditorialHeader kicker="Your rides" headline="Every watt counts" sub="Pulled from Strava —" accent="or filed by hand.">
      {#if connected}
        <CircleButton
          icon="refresh-cw"
          label="Sync with Strava now"
          onclick={onSyncNow}
          disabled={syncing}
          spinning={syncing}
        />
      {:else}
        <CircleButton icon="link" label="Connect Strava in Settings" onclick={() => route.navigate('settings')} />
      {/if}
    </EditorialHeader>

  <input
    bind:this={importInput}
    class="hidden"
    type="file"
    accept=".gpx,.tcx,.fit"
    multiple
    onchange={onImportPick}
    aria-label="Import GPX, TCX or FIT files"
  />

  <!--
    All-time strip, below the week card and above the search.

    Reportedly missing: the log had 32 rides in it and the only figures on the page were this
    week's, so a rider who had not ridden *this* week saw nothing at all. Four label + figure
    pairs, the same rhythm as the week card, from the same rows.
  -->
  {#if lifetime.rides > 0}
    <div class="grid grid-cols-4 gap-2 rounded-card bg-surface border border-hairline px-4 py-3 elevation-card" data-testid="rides-lifetime">
      <div class="flex flex-col items-center">
        <span class="text-[9.5px] font-bold uppercase tracking-wider text-ink-dim">All-time</span>
        <span class="text-base font-extrabold text-ink text-tabular leading-tight">{lifetime.rides}</span>
        <span class="text-[9px] uppercase tracking-wider text-ink-dim">rides</span>
      </div>
      <div class="flex flex-col items-center">
        <span class="text-[9.5px] font-bold uppercase tracking-wider text-ink-dim">Distance</span>
        <span class="text-base font-extrabold text-ink text-tabular leading-tight">{formatDistance(lifetime.km, unit, 0).split(' ')[0]}</span>
        <span class="text-[9px] uppercase tracking-wider text-ink-dim">{distanceUnit(unit)}</span>
      </div>
      <div class="flex flex-col items-center">
        <span class="text-[9.5px] font-bold uppercase tracking-wider text-ink-dim">Time</span>
        <span class="text-base font-extrabold text-ink text-tabular leading-tight">{lifetime.hours}h</span>
        <span class="text-[9px] uppercase tracking-wider text-ink-dim">moving</span>
      </div>
      <div class="flex flex-col items-center">
        <span class="text-[9.5px] font-bold uppercase tracking-wider text-ink-dim">Climbing</span>
        <span class="text-base font-extrabold text-ink text-tabular leading-tight">{formatElevation(lifetime.elev, unit).split(' ')[0]}</span>
        <span class="text-[9px] uppercase tracking-wider text-ink-dim">gain</span>
      </div>
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
        <span
          class="text-base font-extrabold text-rose text-tabular leading-tight"
          title={month.tssEstimated ? 'Week total includes rides scored from speed & elevation — no power data' : undefined}
        >
          {month.tssEstimated ? `~${month.tss}` : month.tss}
        </span>
      </div>
      <CircleButton icon="refresh-cw" label="Strava sync status & settings" onclick={() => route.navigate('settings')} />
    </div>
  </div>

  <!-- Search sits here, under the stats it filters and above the list it narrows. -->
  <div class="h-11 rounded-pill bg-surface border border-hairline flex items-center gap-2 px-4 elevation-card">
    <Icon name="search" size={15} strokeWidth={1.8} class="text-ink-dim shrink-0" />
    <input
      class="w-full min-w-0 bg-transparent text-sm font-semibold text-ink placeholder-ink-dim/60 outline-none [&::-webkit-search-cancel-button]:appearance-none"
      type="search"
      placeholder="Search ride name…"
      aria-label="Search ride name"
      bind:value={query}
    />
    {#if query}
      <button class="shrink-0 text-ink-dim hover:text-ink" onclick={() => (query = '')} aria-label="Clear search">
        <Icon name="x" size={16} strokeWidth={1.8} />
      </button>
    {/if}
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
      {#if query}
        <p class="text-sm text-ink-dim">Try another name, or clear the search.</p>
      {:else}
        <p class="text-sm text-ink-dim">Connect Strava in Settings and your rides pull in on their own — or import a GPX/TCX file below.</p>
      {/if}
    </div>
    <!--
      An empty log is ambiguous on its own: it can mean nothing has been imported yet, or that
      a sync is silently broken. The hint answers that with the stored sync state instead of
      leaving the rider to guess — it is only shown with no rides, and never for an empty search
      result, where a sync status would be answering a question nobody asked.
    -->
    {#if !query}
      <SyncHint />
    {/if}
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
                {activityProvenance(a)}
              </span>
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-bold">{a.name}</p>
              <p class="text-xs text-ink-dim">
                {fmtDate(a.date)} · {formatDistance(a.distanceKm, unit)} · {formatElevation(a.elevGainM, unit)} ↑ · {fmtDur(a.movingSec)}
              </p>
            </div>
            <div class="shrink-0 text-right">
              <!--
                An estimated figure carries a tilde, the same symbol meteorology uses for
                "approximate": the number came from the speed/elevation model, not a meter.
                The tooltip spells it out for anyone the symbol is too subtle for.
              -->
              <p class="text-metric-md text-tabular" title={a.tssEstimated ? 'TSS estimated from speed & elevation — no power data' : undefined}>
                {a.tssEstimated && a.tss != null ? `~${a.tss}` : a.tss ?? '—'}
              </p>
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
    <StatusChip label="Rides come from Strava — computed on this device" status="neutral" />
  </p>
</div>

