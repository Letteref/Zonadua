<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import type { IconName } from '$lib/icons';

  let {
    icon,
    label,
    onclick,
    active = false,
    href
  }: {
    icon: IconName;
    label: string;
    onclick?: () => void;
    active?: boolean;
    href?: string;
  } = $props();

  const cls = $derived(
    active
      ? 'grid h-10 w-10 place-items-center rounded-pill bg-crimson-fill text-white glow-crimson'
      : 'grid h-10 w-10 place-items-center rounded-pill bg-surface border border-hairline text-ink hover:border-hairline-strong transition-colors elevation-card'
  );
</script>

{#if href}
  <a {href} class={cls} aria-label={label} title={label}>
    <Icon name={icon} size={19} strokeWidth={1.5} />
  </a>
{:else}
  <button {onclick} class={cls} aria-label={label} title={label}>
    <Icon name={icon} size={19} strokeWidth={1.5} />
  </button>
{/if}
