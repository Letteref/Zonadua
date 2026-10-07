<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import type { IconName } from '$lib/icons';

  let {
    icon,
    label,
    onclick,
    active = false,
    disabled = false,
    spinning = false,
    href
  }: {
    icon: IconName;
    label: string;
    onclick?: () => void;
    active?: boolean;
    disabled?: boolean;
    /** true while the action runs — the icon turns and the button cannot fire again */
    spinning?: boolean;
    href?: string;
  } = $props();

  const cls = $derived(
    active
      ? 'grid h-10 w-10 place-items-center rounded-pill bg-crimson-fill text-white glow-crimson'
      : 'grid h-10 w-10 place-items-center rounded-pill bg-surface border border-hairline text-ink hover:border-hairline-strong transition-colors elevation-card disabled:opacity-60 disabled:hover:border-hairline'
  );
</script>

{#if href}
  <a {href} class={cls} aria-label={label} title={label}>
    <Icon name={icon} size={19} strokeWidth={1.5} />
  </a>
{:else}
  <button {onclick} {disabled} class={cls} aria-label={label} title={label}>
    <Icon name={icon} size={19} strokeWidth={1.5} class={spinning ? 'animate-spin' : ''} />
  </button>
{/if}
