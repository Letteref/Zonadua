<script lang="ts">
  import { fly } from 'svelte/transition';
  import { Bell, Wrench, Flag, DatabaseBackup, Sparkles, X } from '@lucide/svelte';
  import { allBikesWithComponents, computeWear, nextRace, appSettings } from '$lib/data/queries.svelte';

  let open = $state(false);
  let root: HTMLDivElement | null = $state(null);

  const bikes = $derived(allBikesWithComponents.current ?? []);

  /** F3-AC3: all components ≥90% of interval, across every bike, worst first. */
  const wearAlerts = $derived(
    bikes
      .flatMap(({ bike, components }) =>
        components.map((c) => ({ comp: c, bikeName: bike.name, wear: computeWear(c, bike.odometerKm) }))
      )
      .filter((w) => w.wear.status !== 'aman')
      .sort((a, b) => b.wear.pct - a.wear.pct)
  );

  const daysTo = (iso: string): number => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  const raceAlert = $derived.by(() => {
    const r = nextRace.current;
    if (!r) return null;
    const d = daysTo(r.startTime);
    return { name: r.name, days: d, live: r.status === 'live', urgent: d <= 14 || r.status === 'live' };
  });

  const BACKUP_MS = 30 * 86_400_000;
  const backupAlert = $derived.by(() => {
    const t = appSettings.current?.lastBackupAt;
    const stale = !t || Date.now() - t > BACKUP_MS;
    if (!stale) return null;
    return { last: t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null };
  });

  const keyAlert = $derived(!appSettings.current?.aiKey);

  const items = $derived.by(() => {
    const list: { id: string; icon: typeof Wrench; tone: 'kritis' | 'warn' | 'aman' | 'signal'; title: string; sub: string; href: string }[] = [];
    for (const w of wearAlerts.slice(0, 3)) {
      list.push({
        id: `wear-${w.comp.id}`,
        icon: Wrench,
        tone: w.wear.status === 'kritis' ? 'kritis' : 'warn',
        title: `${w.comp.name} · ${Math.round(w.wear.pct * 100)}%`,
        sub: `${w.bikeName} — ${w.wear.leftKm >= 0 ? `${w.wear.leftKm.toLocaleString()} km left` : `${Math.abs(w.wear.leftKm).toLocaleString()} km over`} of ${w.comp.intervalKm.toLocaleString()} km`,
        href: '#/gear'
      });
    }
    if (raceAlert) {
      list.push({
        id: 'race',
        icon: Flag,
        tone: raceAlert.urgent ? 'signal' : 'aman',
        title: raceAlert.live ? `${raceAlert.name} — live now` : `${raceAlert.name} in ${raceAlert.days} day${raceAlert.days === 1 ? '' : 's'}`,
        sub: raceAlert.live ? 'Race mode is tracking — open the live tracker' : 'Review the race plan and cut-offs',
        href: '#/race'
      });
    }
    if (backupAlert) {
      list.push({
        id: 'backup',
        icon: DatabaseBackup,
        tone: 'warn',
        title: 'Backup overdue',
        sub: backupAlert.last ? `Last backup ${backupAlert.last} — export a JSON copy` : 'No backup yet — export a JSON copy',
        href: '#/settings'
      });
    }
    if (keyAlert) {
      list.push({
        id: 'aikey',
        icon: Sparkles,
        tone: 'aman',
        title: 'AI coach key not set',
        sub: 'Add your own API key to unlock weekly reviews',
        href: '#/settings'
      });
    }
    return list;
  });

  const hasActive = $derived(items.some((i) => i.tone !== 'aman'));

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') open = false;
  }

  function onDocClick(e: MouseEvent): void {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }

  function go(): void {
    open = false;
  }
</script>

<svelte:window onkeydown={onKeydown} onpointerdown={onDocClick} />

<div class="relative shrink-0" bind:this={root}>
  <button
    class="relative h-10 w-10 rounded-pill bg-surface border border-hairline grid place-items-center text-ink-dim hover:text-ink transition-colors elevation-card"
    aria-label="Reminders"
    title="Reminders"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <Bell size={18} strokeWidth={1.5} />
    {#if hasActive}
      <span class="absolute top-1.5 right-1.5 h-2 w-2 rounded-pill bg-crimson border border-surface"></span>
      <span class="sr-only">Active reminders</span>
    {/if}
  </button>

  {#if open}
    <div
      class="fixed sm:absolute left-4 right-4 sm:left-auto sm:right-0 top-16 sm:top-12 z-[80] sm:w-[320px] rounded-card bg-surface border border-hairline elevation-raised overflow-hidden"
      transition:fly={{ y: 6, duration: 140 }}
      role="dialog"
      aria-label="Reminders panel"
    >
      <div class="flex items-center justify-between px-4 pt-3.5 pb-2">
        <span class="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-dim">Reminders</span>
        <button class="grid h-7 w-7 place-items-center rounded-pill bg-tile border border-hairline text-ink-dim hover:text-ink transition-colors" aria-label="Close reminders" onclick={() => (open = false)}>
          <X size={14} strokeWidth={1.8} />
        </button>
      </div>

      {#if items.length === 0}
        <p class="px-4 pb-4 text-sm text-ink-dim">All clear — gear, race plan and backup are in good shape.</p>
      {:else}
        <ul class="pb-2">
          {#each items as item (item.id)}
            <li>
              <a
                href={item.href}
                class="flex items-start gap-3 px-4 py-2.5 hover:bg-tile transition-colors"
                aria-label={item.title}
                onclick={go}
              >
                <span class="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-pill bg-tile border border-hairline {item.tone === 'kritis' ? 'text-kritis' : item.tone === 'warn' ? 'text-warn' : item.tone === 'signal' ? 'text-crimson-deep' : 'text-aman'}">
                  <item.icon size={16} strokeWidth={1.6} />
                </span>
                <span class="flex min-w-0 flex-col">
                  <span class="text-[13px] font-bold text-ink tracking-tight">{item.title}</span>
                  <span class="text-[11px] text-ink-dim leading-snug">{item.sub}</span>
                </span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>
