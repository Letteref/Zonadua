<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
    import SectionCard from '$lib/components/SectionCard.svelte';
  import PowerCurveChart from '$lib/components/PowerCurveChart.svelte';
  import StatTile from '$lib/components/StatTile.svelte';
  import StatTrio from '$lib/components/StatTrio.svelte';
  import LegendPill from '$lib/components/LegendPill.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import { allActivities, appSettings, ftpSeries, powerCurves, powerZones } from '$lib/data/queries.svelte';
  import { db, activityProvenance } from '$lib/data/db';
  import { decodeStream, extractPower, type PowerTrace } from '$lib/data/streams';
  import { ftpOnDate } from '$lib/domain/metrics';
  import { fitCriticalPower, mergePowerCurves } from '$lib/domain/power-curve';
  import { fmtDuration, highIntensityShare, zoneDistribution, type ZoneDistribution } from '$lib/domain/zones';
  import { formatDistance, formatElevation, type UnitSystem } from '$lib/domain/units';

  let { id }: { id: string } = $props();

  const activity = $derived((allActivities.current ?? []).find((a) => a.id === id));
  const unit = $derived<UnitSystem>(appSettings.current?.unit ?? 'metric');

  // ---- power trace: decoded once per activity, off the reactive path ----
  let trace = $state<PowerTrace | null>(null);
  let decodedFor = $state<string | null>(null);

  $effect(() => {
    const currentId = id;
    if (decodedFor === currentId) return;
    let cancelled = false;
    void (async () => {
      const row = await db.activity_streams.get(currentId);
      const samples = await decodeStream(row);
      if (cancelled) return;
      trace = extractPower(samples);
      decodedFor = currentId;
    })();
    return () => {
      cancelled = true;
    };
  });

  // ---- derived metrics ----
  const rideCurve = $derived((powerCurves.current ?? []).find((c) => c.activityId === id)?.points ?? []);
  const athleteCurve = $derived(mergePowerCurves((powerCurves.current ?? []).map((c) => c.points)));
  const rideFit = $derived(rideCurve.length >= 4 ? fitCriticalPower(rideCurve) : undefined);

  const ftp = $derived(activity ? ftpOnDate(ftpSeries.current ?? [], activity.date) : 0);
  const zones = $derived<ZoneDistribution | null>(
    trace && ftp > 0
      ? zoneDistribution(trace.watts, ftp, trace.sampleSec, powerZones.current ?? undefined)
      : null
  );
  const hiShare = $derived(zones ? highIntensityShare(zones) : null);

  const ftpDate = $derived.by(() => {
    if (!activity) return null;
    const rows = [...(ftpSeries.current ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const value = ftpOnDate(rows, activity.date);
    const hit = [...rows].reverse().find((r) => r.ftp === value);
    return hit ? { value, date: hit.date } : null;
  });

  const fmtDate = (iso: string): string =>
    new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtNum = (n: number | undefined, digits = 1): string =>
    n == null || !Number.isFinite(n) ? '—' : n.toFixed(digits);

  // Zone colours: neutral greys for easy work, the crimson ramp for intensity.
  const ZONE_COLORS: Record<string, string> = {
    Z0: '#d9dce0',
    Z1: '#a8adb5',
    Z2: '#6f757e',
    Z3: '#ff4d5e',
    Z4: '#e8102e',
    Z5: '#a80c21',
    Z6: '#7a0a19',
    Z7: '#141519'
  };
</script>

<div class="mx-auto max-w-md px-5 pt-8 space-y-5">
  {#if !allActivities.ready}
    <div class="rounded-card bg-surface border border-hairline p-8 text-center elevation-card">
      <span class="kicker">Loading ride…</span>
    </div>
  {:else if !activity}
    <div class="rounded-card bg-surface border border-hairline p-8 text-center space-y-3 elevation-card">
      <span class="kicker block">Ride not found</span>
      <p class="text-sm text-ink-dim">This activity is no longer in your local database.</p>
      <a href="#/rides" class="inline-flex items-center gap-1 text-sm font-bold text-crimson-deep">
        <Icon name="chevron-left" size={16} strokeWidth={2} /> Back to rides
      </a>
    </div>
  {:else}
    <!-- header -->
    <div class="space-y-3">
      <a
        href="#/rides"
        class="inline-flex items-center gap-1 rounded-pill bg-surface border border-hairline px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-dim elevation-card"
      >
        <Icon name="chevron-left" size={14} strokeWidth={2} /> Rides
      </a>
      <div>
        <div class="flex items-center gap-2">
          <span class="kicker">{fmtDate(activity.date)}</span>
          <StatusChip label={activityProvenance(activity)} status="neutral" />
          {#if activity.commute}
            <StatusChip label="Commute" status="neutral" />
          {/if}
        </div>
        <h1 class="mt-1 text-metric-hero text-ink">{activity.name}</h1>
      </div>
    </div>

    <!-- headline numbers -->
    <SectionCard dark>
      {#snippet chrome()}
        <div class="flex items-center justify-between gap-2 bg-black/40 border-b border-white/10 px-3.5 h-9">
          <div class="flex items-center gap-1.5" aria-hidden="true">
            <span class="h-2.5 w-2.5 rounded-pill bg-crimson"></span>
            <span class="h-2.5 w-2.5 rounded-pill bg-[#eab308]/85"></span>
            <span class="h-2.5 w-2.5 rounded-pill bg-[#22c55e]/85"></span>
          </div>
          <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-on-mono-dim">
            {activityProvenance(activity)} · {activity.movingSec > 0 ? 'moving' : 'no time'}
          </span>
        </div>
      {/snippet}
      <div class="grid grid-cols-3 divide-x divide-white/10 text-center">
        <div class="flex flex-col items-center px-1">
          <Icon name="route" size={16} strokeWidth={1.8} class="text-on-mono-dim" />
          <span class="mt-1.5 text-metric-md text-tabular text-on-mono">{formatDistance(activity.distanceKm, unit).split(' ')[0]}</span>
          <span class="text-[9px] font-bold uppercase tracking-wider text-on-mono-dim">{formatDistance(activity.distanceKm, unit).split(' ')[1]}</span>
        </div>
        <div class="flex flex-col items-center px-1">
          <Icon name="clock" size={16} strokeWidth={1.8} class="text-on-mono-dim" />
          <span class="mt-1.5 text-metric-md text-tabular text-on-mono">{fmtDuration(activity.movingSec)}</span>
          <span class="text-[9px] font-bold uppercase tracking-wider text-on-mono-dim">moving</span>
        </div>
        <div class="flex flex-col items-center px-1">
          <Icon name="zap" size={16} strokeWidth={1.8} class="text-rose" />
          <span class="mt-1.5 text-metric-md text-tabular text-on-mono">{activity.np ?? '—'}</span>
          <span class="text-[9px] font-bold uppercase tracking-wider text-on-mono-dim">NP watts</span>
        </div>
      </div>
    </SectionCard>

    <!-- training load -->
    <div class="grid grid-cols-2 gap-3">
      <StatTile
        label="Intensity factor"
        value={activity.if != null ? activity.if.toFixed(2) : '—'}
        sub={activity.if != null && ftp > 0 ? `NP ${activity.np} W / FTP ${ftp} W` : 'Needs power + FTP'}
      />
      <StatTile
        label="Training stress"
        value={activity.tss != null ? String(activity.tss) : '—'}
        sub={activity.tss != null ? 'This ride only' : 'Needs power'}
      />
      <StatTile
        label="Elevation"
        value={formatElevation(activity.elevGainM, unit).split(' ')[0]}
        unit={formatElevation(activity.elevGainM, unit).split(' ')[1]}
      />
      <StatTile label="Energy" value={String(activity.kcal)} unit="kcal" sub={activity.avgPower ? `from ${activity.avgPower} W avg` : undefined} />
    </div>

    <!-- power curve -->
    <SectionCard kicker="Power curve">
      {#snippet right()}
        <LegendPill
          items={[
            { label: 'This ride', dot: 'signal' },
            { label: 'All-time best', dot: 'outline' }
          ]}
        />
      {/snippet}
      {#if rideCurve.length >= 2}
        <PowerCurveChart curve={rideCurve} fit={rideFit} compare={athleteCurve} />
        <div class="mt-4 pt-3 border-t border-hairline">
          <StatTrio
            items={[
              { label: 'Best 5 min', value: `${rideCurve.find((p) => p.durationSec === 300)?.watts ?? '—'} W` },
              { label: 'Best 20 min', value: `${rideCurve.find((p) => p.durationSec === 1200)?.watts ?? '—'} W` },
              { label: "Ride W'", value: rideFit ? `${(rideFit.wPrime / 1000).toFixed(1)} kJ` : '—' }
            ]}
          />
        </div>
      {:else}
        <div class="grid place-items-center py-10 text-center">
          <span class="kicker">No power in this file</span>
          <p class="mt-1.5 max-w-[26ch] text-[11px] font-medium text-ink-dim">
            GPX and TCX carry no watt data, so IF, TSS, zones and the curve stay blank rather than guessed.
          </p>
        </div>
      {/if}
    </SectionCard>

    <!-- zones -->
    <SectionCard kicker="Time in zones">
      {#snippet right()}
        {#if hiShare !== null}
          <LegendPill items={[{ label: `${hiShare}% ≥ sweet spot`, dot: 'signal' }]} />
        {/if}
      {/snippet}
      {#if zones && zones.totalSec > 0}
        <div class="flex h-2.5 w-full overflow-hidden rounded-pill" role="img" aria-label="Time in each power zone">
          {#each zones.zones.filter((z) => z.sec > 0) as z (z.band.key)}
            <span
              class="h-full"
              style="width:{z.pct}%; background:{ZONE_COLORS[z.band.key]}"
              title="{z.band.name}: {fmtDuration(z.sec)}"
            ></span>
          {/each}
        </div>
        <ul class="mt-4 flex flex-col divide-y divide-hairline">
          {#each zones.zones as z (z.band.key)}
            <li class="flex items-center gap-3 py-2">
              <span class="h-2.5 w-2.5 shrink-0 rounded-pill" style="background:{ZONE_COLORS[z.band.key]}"></span>
              <span class="min-w-0 flex-1">
                <span class="block text-[13px] font-bold text-ink">{z.band.name}</span>
                <span class="block text-[10px] font-semibold text-ink-dim">
                  {z.band.key} · from {z.minWatts} W
                </span>
              </span>
              <span class="shrink-0 text-right">
                <span class="block text-[13px] font-bold text-tabular text-ink">{fmtDuration(z.sec)}</span>
                <span class="block text-[10px] font-semibold text-ink-dim">{z.pct}%</span>
              </span>
            </li>
          {/each}
        </ul>
        <div class="mt-3 pt-3 border-t border-hairline flex items-center justify-between text-[11px]">
          <span class="flex items-center gap-1.5 font-medium text-ink-dim">
            <Icon name="mountain" size={13} strokeWidth={1.8} /> {fmtNum(zones.avgPower, 0)} W average
          </span>
          {#if ftpDate}
            <span class="font-semibold text-ink-dim">zones vs FTP {ftpDate.value} W</span>
          {/if}
        </div>
      {:else}
        <div class="grid place-items-center py-8 text-center">
          <span class="kicker">Nothing to distribute</span>
          <p class="mt-1.5 max-w-[26ch] text-[11px] font-medium text-ink-dim">
            {#if trace}
              No FTP on record for this date, so zone boundaries cannot be set.
            {:else}
              This ride has no power stream.
            {/if}
          </p>
        </div>
      {/if}
    </SectionCard>

    {#if ftpDate}
      <p class="flex items-center justify-center gap-1.5 pt-1 text-center text-[11px] font-medium text-ink-dim">
        <Icon name="heart" size={13} strokeWidth={1.8} />
        IF and TSS scored against FTP {ftpDate.value} W, measured {ftpDate.date}
      </p>
    {/if}
  {/if}
</div>