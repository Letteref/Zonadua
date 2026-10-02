<script lang="ts">
  type Icon =
    | 'search'
    | 'file-up'
    | 'refresh-cw'
    | 'plus'
    | 'bell'
    | 'history'
    | 'settings'
    | 'user'
    | 'arrow-up-right'
    | 'pencil'
    | 'chevron-left'
    | 'info'
    | 'sliders-horizontal'
    | 'share-2';

  import {
    Search,
    FileUp,
    RefreshCw,
    Plus,
    Bell,
    History,
    Settings,
    User,
    ArrowUpRight,
    Pencil,
    ChevronLeft,
    Info,
    SlidersHorizontal,
    Share2
  } from '@lucide/svelte';

  let {
    icon,
    label,
    onclick,
    active = false,
    href
  }: {
    icon: Icon;
    label: string;
    onclick?: () => void;
    active?: boolean;
    href?: string;
  } = $props();

  const icons = {
    search: Search,
    'file-up': FileUp,
    'refresh-cw': RefreshCw,
    plus: Plus,
    bell: Bell,
    history: History,
    settings: Settings,
    user: User,
    'arrow-up-right': ArrowUpRight,
    pencil: Pencil,
    'chevron-left': ChevronLeft,
    info: Info,
    'sliders-horizontal': SlidersHorizontal,
    'share-2': Share2
  } as const;

  const Ic = $derived(icons[icon]);
  const cls = $derived(
    active
      ? 'grid h-10 w-10 place-items-center rounded-pill bg-crimson-fill text-white glow-crimson'
      : 'grid h-10 w-10 place-items-center rounded-pill bg-surface border border-hairline text-ink hover:border-hairline-strong transition-colors elevation-card'
  );
</script>

{#if href}
  <a {href} class={cls} aria-label={label} title={label}>
    <Ic size={19} strokeWidth={1.5} />
  </a>
{:else}
  <button {onclick} class={cls} aria-label={label} title={label}>
    <Ic size={19} strokeWidth={1.5} />
  </button>
{/if}
