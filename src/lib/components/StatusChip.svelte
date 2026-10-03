<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  
  type Status = 'aman' | 'waspada' | 'kritis' | 'neutral' | 'signal';

  let {
    label,
    status = 'neutral',
    icon,
    onDark = false
  }: { label: string; status?: Status; icon?: 'check' | 'warn' | 'alert' | 'lock'; onDark?: boolean } = $props();

  const light: Record<Status, { fg: string; border: string; bg: string }> = {
    aman: { fg: '#0a7450', border: 'rgba(10,116,80,0.35)', bg: 'rgba(10,116,80,0.08)' },
    waspada: { fg: '#b8620a', border: 'rgba(184,98,10,0.35)', bg: 'rgba(184,98,10,0.08)' },
    kritis: { fg: '#c8102e', border: 'rgba(200,16,46,0.35)', bg: 'rgba(200,16,46,0.08)' },
    neutral: { fg: '#6e6a5e', border: 'rgba(98,101,108,0.4)', bg: 'rgba(98,101,108,0.08)' },
    signal: { fg: '#a80c21', border: 'rgba(168,12,33,0.4)', bg: 'rgba(232,16,46,0.08)' }
  };
  const dark: Record<Status, { fg: string; border: string; bg: string }> = {
    aman: { fg: '#4ade9a', border: 'rgba(74,222,154,0.35)', bg: 'rgba(74,222,154,0.1)' },
    waspada: { fg: '#ffb35a', border: 'rgba(255,179,90,0.35)', bg: 'rgba(255,179,90,0.1)' },
    kritis: { fg: '#ff8a92', border: 'rgba(255,138,146,0.4)', bg: 'rgba(200,16,46,0.18)' },
    neutral: { fg: '#9b968a', border: 'rgba(155,150,138,0.35)', bg: 'rgba(155,150,138,0.08)' },
    signal: { fg: '#ff4d5e', border: 'rgba(255,138,61,0.45)', bg: 'rgba(232,16,46,0.2)' }
  };
  const c = $derived((onDark ? dark : light)[status]);
</script>

<span
  class="inline-flex h-6 items-center gap-1 rounded-pill px-2.5 text-[10px] font-extrabold uppercase tracking-[0.08em] whitespace-nowrap"
  style="color:{c.fg};border:1px solid {c.border};background:{c.bg};"
>
  {#if icon === 'check'}
    <Icon name="check" size={12} />
  {:else if icon === 'warn'}
    <Icon name="triangle-alert" size={12} />
  {:else if icon === 'alert'}
    <Icon name="octagon-alert" size={12} />
  {:else if icon === 'lock'}
    <Icon name="lock" size={12} />
  {/if}
  {label}
</span>
