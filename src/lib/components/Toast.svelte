<script lang="ts">
  import Icon from './Icon.svelte';
  import type { IconName } from '$lib/icons';
  import { toast, type ToastTone } from '$lib/toast.svelte';

  /**
   * The one place a message appears above the nav. Mounted once in `App.svelte`, which is
   * what lets any route report a failure without owning a pill of its own.
   *
   * The tone is read from the store, not passed in: a component that let its caller pick
   * the colour is a component that will eventually paint a failure green.
   */
  const GLYPH: Record<ToastTone, { icon: IconName; class: string }> = {
    ok: { icon: 'check-circle', class: 'text-aman' },
    error: { icon: 'octagon-alert', class: 'text-rose' },
    busy: { icon: 'loader-circle', class: 'text-rose animate-spin' }
  };
</script>

{#if toast.current}
  {@const g = GLYPH[toast.current.tone]}
  <div
    class="fixed inset-x-0 bottom-[calc(88px+env(safe-area-inset-bottom,0px)+8px)] z-[55] mx-auto max-w-md px-5"
    role="status"
    aria-live="polite"
  >
    <div class="flex items-center justify-center gap-2 rounded-pill bg-mono text-on-mono px-4 py-2.5 elevation-raised">
      <Icon name={g.icon} size={15} strokeWidth={2} class={g.class} />
      <span class="text-[11px] font-bold uppercase tracking-wider">{toast.current.text}</span>
      <button
        class="-mr-1 shrink-0 text-on-mono/60 hover:text-on-mono transition-colors"
        aria-label="Dismiss message"
        onclick={() => toast.clear()}
      >
        <Icon name="x" size={14} strokeWidth={2.2} />
      </button>
    </div>
  </div>
{/if}
