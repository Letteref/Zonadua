<script lang="ts">
  /**
   * The floating install prompt — the first of the store's two doors.
   *
   * It appears only when the store says a real prompt is live **and** the rider has
   * already touched the app (`canInstall`), so there is no path where the Install button
   * does nothing, and no popup ambushing someone who has not interacted yet: browsers
   * that never fire `beforeinstallprompt` (iOS Safari, desktop Firefox) simply never show
   * this card and get the manual instructions in Settings instead. "Not now" is
   * remembered in localStorage — the banner as a whole stays gone across sessions,
   * while the Settings row remains as the deliberate second door.
   *
   * Position: one floating slot above the nav (96 px + safe area, the same slot the
   * toast uses — toast z-55, banner z-54, nav FAB z-60). Sharing the slot means a
   * confirmation would land straight across this card, so while a toast is up the
   * banner steps up 54 px and eases back down when it clears: the gap to the nav stays
   * tight in the resting state, and nothing ever stacks.
   */
  import { pwaInstall } from '$lib/pwa-install.svelte';
  import { toast } from '$lib/toast.svelte';
  import Icon from './Icon.svelte';

  /** Resting bottom = toast slot (96 px); a live toast lifts the card clear of it. */
  const bottom = $derived(
    `calc(${toast.current ? 150 : 96}px + env(safe-area-inset-bottom, 0px))`
  );

  async function install(): Promise<void> {
    const outcome = await pwaInstall.promptInstall();
    if (outcome === 'accepted') toast.ok('Zonadua installed — open it from your home screen');
    else if (outcome === 'dismissed') pwaInstall.dismiss();
    // 'unavailable' means the captured prompt evaporated under us: the card closes
    // itself with the state change, and the honest fallback lives in Settings.
  }
</script>

{#if pwaInstall.canInstall}
  <div
    class="fixed inset-x-0 z-[54] mx-auto max-w-md px-5 transition-[bottom] duration-300 ease-out motion-reduce:transition-none"
    style="bottom: {bottom};"
  >
    <div
      class="install-card rounded-card border border-hairline bg-surface p-4 elevation-raised"
      role="dialog"
      aria-label="Install Zonadua"
    >
      <div class="flex items-start gap-3">
        <span class="grid h-9 w-9 shrink-0 place-items-center rounded-pill bg-crimson/10 text-crimson">
          <Icon name="download" size={18} strokeWidth={1.8} />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-bold text-ink">Install Zonadua</p>
          <p class="mt-0.5 text-xs leading-5 text-ink-dim">
            A proper home-screen app that keeps working offline — no app store needed.
          </p>
        </div>
        <button
          class="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-pill text-ink-dim transition-colors hover:bg-tile hover:text-ink"
          aria-label="Dismiss install banner"
          onclick={() => pwaInstall.dismiss()}
        >
          <Icon name="x" size={15} strokeWidth={2.2} />
        </button>
      </div>
      <!--
        One clear primary, one clearly quiet: Install takes the remaining width as the
        only crimson fill on the card; Not now drops its fill and border to a bare
        ink-dim label. Equal-sized twin pills made both look like the same choice.
        pl-12 keeps the row aligned with the copy above (icon column + gap), not the
        card edge.
      -->
      <div class="mt-3 flex items-stretch gap-2 pl-12">
        <button
          class="h-10 min-w-0 flex-1 rounded-pill bg-crimson-fill px-5 text-[11px] font-extrabold uppercase tracking-wider text-white active:scale-[0.98] transition-transform"
          onclick={install}
        >
          Install
        </button>
        <button
          class="h-10 shrink-0 rounded-pill px-3 text-[11px] font-bold uppercase tracking-wider text-ink-dim transition-colors hover:bg-tile hover:text-ink"
          onclick={() => pwaInstall.dismiss()}
        >
          Not now
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .install-card {
    animation: install-rise 320ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes install-rise {
    from {
      opacity: 0;
      transform: translateY(14px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
</style>
