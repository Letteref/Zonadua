<script lang="ts">
  import { fly } from 'svelte/transition';
  import { tick } from 'svelte';
  import { Gauge, Activity, Bike, Sparkles, Map as MapIcon, Timer, Plus, ArrowUpRight } from '@lucide/svelte';
  import { route, type RouteName } from '$lib/router.svelte';

  /** v5.6.4 capsule dock: active tab = SLIDING white pill (measured, animates between tabs),
   *  icon+title white; inactive icon-only dim; quick-action plus at right edge in halo ring,
   *  ink idle → crimson when active/open (+ rotates to ×); plan panel instead of dial pills. */
  const items: { name: RouteName; label: string; icon: typeof Gauge }[] = [
    { name: 'dashboard', label: 'Home', icon: Gauge },
    { name: 'rides', label: 'Rides', icon: Activity },
    { name: 'gear', label: 'Gear', icon: Bike },
    { name: 'coach', label: 'Coach', icon: Sparkles }
  ];

  const dial: { name: RouteName; label: string; sub: string; icon: typeof MapIcon }[] = [
    { name: 'routes', label: 'Routes', sub: 'Route library & GPX plans', icon: MapIcon },
    { name: 'race', label: 'Race', sub: 'Live tracker & pacing', icon: Timer }
  ];

  let fabOpen = $state(false);
  let fabRoot: HTMLDivElement | null = $state(null);

  const fabActive = $derived(route.name === 'routes' || route.name === 'race');
  const plusHot = $derived(fabActive || fabOpen);

  // ---- sliding highlight: satu pill putih yang bergeser antar tab ----
  let barEl: HTMLDivElement | null = $state(null);
  let tabEls: Partial<Record<RouteName, HTMLAnchorElement>> = {};
  let slider = $state({ x: 0, w: 0, ready: false });
  let measured = $state(false);

  const activeTab = $derived(items.find((i) => i.name === route.name)?.name ?? null);

  function measureSlider(): void {
    const el = activeTab ? tabEls[activeTab] : undefined;
    if (el && barEl) slider = { x: el.offsetLeft, w: el.offsetWidth, ready: true };
    else slider = { ...slider, ready: false };
    measured = true;
  }

  // ukur ulang setiap kali tab aktif berpindah (setelah DOM diperbarui)
  $effect(() => {
    void activeTab;
    void tick().then(measureSlider);
  });
  // lebar label bisa bergeser setelah webfont termuat — ukur ulang sekali
  $effect(() => {
    document.fonts?.ready.then(() => measureSlider());
  });

  function go(): void {
    fabOpen = false;
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') fabOpen = false;
  }

  function onDocPointer(e: PointerEvent): void {
    if (fabOpen && fabRoot && !fabRoot.contains(e.target as Node)) fabOpen = false;
  }
</script>

<svelte:window onkeydown={onKeydown} onpointerdown={onDocPointer} onresize={measureSlider} />

<nav class="fixed inset-x-0 bottom-0 z-50 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+14px)]" aria-label="Primary">
  <div class="mx-auto max-w-md">
    <!-- capsule dock: satu layer solid — tanpa mask, semua klik tertahan di bar -->    <div
      bind:this={barEl}
      class="relative h-16 rounded-full bg-mono/95 backdrop-blur-xl bg-mono-gradient glow-mono flex items-center justify-between gap-1 border border-white/10 px-2"
    >
      <!-- sliding highlight: pill putih-transparan yang bergeser mulus ke tab aktif.
           Tanpa transisi saat penempatan pertama (measured=false) agar tidak "terbang" saat load -->
      <div
        class="absolute top-1/2 left-0 h-11 rounded-full bg-white/15 will-change-transform {measured
          ? 'transition-[transform,width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
          : ''} {slider.ready ? '' : 'opacity-0'}"
        style="transform: translateX({slider.x}px) translateY(-50%); width: {slider.w}px"
        aria-hidden="true"
      ></div>
      {#each items as item (item.name)}
          {@const Icon = item.icon}
          {@const active = route.name === item.name}
          <a
            bind:this={tabEls[item.name]}
            href="#/{item.name === 'dashboard' ? '' : item.name}"
            class="relative z-[1] transition-colors {active
              ? 'flex h-11 items-center gap-1.5 rounded-full px-4 text-white'
              : 'flex h-11 w-11 items-center justify-center text-on-mono/50 hover:text-on-mono'}"
          aria-label={item.label}
          title={item.label}
          aria-current={active ? 'page' : undefined}
        >
          <Icon size={active ? 20 : 22} strokeWidth={active ? 2 : 1.5} />
          {#if active}
            <!-- v5.6.1: highlight aktif = PUTIH pada icon & title -->
            <span in:fly={{ y: 4, duration: 140 }} class="text-xs font-bold tracking-tight">{item.label}</span>
          {/if}
        </a>
      {/each}

        <!-- Quick action (right edge): halo ring putih-transparan sebagai separasi
             (bahasa sama dengan pill aktif); tombol ink → crimson saat aktif/terbuka -->
      <div class="relative z-[60] shrink-0" bind:this={fabRoot}>
        {#if fabOpen}
          <!-- panel menu melayang dari pojok kanan (di atas tombol +) — tanpa scrim:
               click-outside & Escape sudah menutup, layar tidak digelapkan -->
          <div
            class="absolute right-0 bottom-[calc(100%+14px)] w-[248px] origin-bottom-right rounded-card border border-hairline bg-surface p-1.5 elevation-raised"
            transition:fly={{ y: 8, duration: 160 }}
          >
            <div class="flex items-center justify-between px-2.5 pb-1 pt-1.5">
              <span class="text-[9px] font-extrabold uppercase tracking-[0.14em] text-ink-dim">Plan</span>
              <span class="text-[9px] font-semibold text-ink-dim/70">2 destinations</span>
            </div>
            {#each dial as d (d.name)}
              {@const Icon = d.icon}
              {@const active = route.name === d.name}
              <a
                href="#/{d.name}"
                class="group flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors {active
                  ? 'bg-crimson/10'
                  : 'hover:bg-tile'}"
                aria-label={d.label}
                aria-current={active ? 'page' : undefined}
                onclick={go}
              >
                <span
                  class="grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors {active
                    ? 'bg-crimson-fill text-white'
                    : 'bg-tile text-ink group-hover:bg-surface'}"
                >
                  <Icon size={17} strokeWidth={1.8} />
                </span>
                <span class="flex min-w-0 flex-1 flex-col leading-tight">
                  <span class="text-[13px] font-bold {active ? 'text-crimson-deep' : 'text-ink'}">{d.label}</span>
                  <span class="truncate text-[10px] text-ink-dim">{d.sub}</span>
                </span>
                <ArrowUpRight
                  size={14}
                  strokeWidth={1.8}
                  class="shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 {active
                    ? 'text-crimson-deep'
                    : 'text-ink-dim'}"
                />
              </a>
            {/each}
          </div>
        {/if}
        <div
          class="rounded-full bg-white/12 p-[3px] {plusHot ? 'ring-1 ring-white/20' : ''}"
        >
          <button
            class="grid h-11 w-11 place-items-center rounded-full border transition-all duration-200 active:scale-90 active:bg-crimson-gradient active:text-white {plusHot
              ? 'bg-crimson-gradient glow-signal border-white/25 text-white'
              : 'bg-mono-gradient border-[#2b2d33] text-rose'} {fabOpen ? 'rotate-45' : ''}"
            aria-label="Plan: routes & races"
            aria-expanded={fabOpen}
            onclick={() => (fabOpen = !fabOpen)}
          >
            <Plus size={22} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>

    {#if fabOpen}
      <!-- scrim dihapus (v5.6.3): layer gelap layar penuh saat dial terbuka dianggap bug
           oleh user; click-outside (onDocPointer) + Escape sudah menutup dial -->
    {/if}
  </div>
</nav>
