<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { syncState } from '$lib/data/queries.svelte';
  import { syncStatus } from '$lib/infra/strava/status';

  /**
   * One honest line about where the rider's data comes from.
   *
   * The demo data is dev-only, so a production first launch has no activities and no gear.
   * An empty screen cannot tell the difference between "nothing imported yet" and "something
   * is broken", so this states which one it is and what to do — and once a sync has run it
   * says when, so an empty day reads as a day without a ride rather than a missed sync.
   *
   * The wording and the thresholds live in `infra/strava/status` so every surface that
   * reports sync gives the same answer; this component only renders it.
   */
  const status = $derived(syncStatus(syncState.current));
  const tone = $derived(status.tone === 'ok' ? 'text-ink-dim' : 'text-warn');
</script>

<div class="flex items-start gap-3 rounded-card bg-surface border border-hairline px-4 py-3 elevation-card">
  <Icon name="refresh-cw" size={16} strokeWidth={1.6} class="{tone} shrink-0 mt-0.5" />
  <!--
    The label and the sentence are one paragraph, not a label column beside a value column.
    Written as a two-child `flex-col` block this happened to match the shape the Rides hero
    audit uses to count the hero's figures, and the page then reported four columns for a
    card that has three.
  -->
  <p class="min-w-0 text-[12px] text-ink-dim leading-relaxed">
    <span class="block text-[10px] font-extrabold uppercase tracking-wider {tone}">{status.label}</span>
    {status.detail}
  </p>
</div>
