<script lang="ts">
  /**
   * Step 3 — power meter: do you have one?
   *
   * "Yes" reveals the 20-minute-effort entry; the FTP shown is 95% of the average power,
   * matching the calculator in Settings. "No" shows the estimated-protocol card: what Zonadua
   * will do instead, and — importantly — that the resulting figure is always labelled as an
   * estimate so the rider is never chasing a number the app invented and dressed up as real.
   */
  import MetricStepper from '$lib/components/MetricStepper.svelte';
  import { saveFtp } from '$lib/data/onboarding.svelte';
  import { ftpFromTwentyMinute } from '$lib/domain/onboarding';
  import { toast } from '$lib/toast.svelte';

  let { onnext }: { onnext: () => void } = $props();

  let hasMeter = $state<boolean | null>(null);
  let avgW = $state(250);
  let saving = $state(false);

  const ftp = $derived(ftpFromTwentyMinute(avgW));

  function pick(yes: boolean) {
    hasMeter = yes;
  }

  async function next() {
    if (hasMeter === false) {
      // No meter: write nothing. The protocol card already said the estimate comes from
      // the ride data, so there is no threshold to store here.
      onnext();
      return;
    }
    if (hasMeter === null) {
      // Nothing chosen yet — treat Continue as "not now" rather than guessing a branch.
      onnext();
      return;
    }
    saving = true;
    try {
      const stored = await saveFtp(ftp ?? 0);
      if (stored !== null) toast.ok(`FTP ${stored} W saved`);
      onnext();
    } catch (err) {
      console.error('[zonadua] onboarding ftp failed:', err);
      toast.error('Could not save your FTP — check again');
    } finally {
      saving = false;
    }
  }
</script>

<div class="flex flex-col gap-4 pb-4">
  <div>
    <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-crimson-deep">Power</span>
    <h1 class="mt-1 text-[22px] font-extrabold leading-tight tracking-tight text-ink">
      Do you ride with a power meter?
    </h1>
    <p class="mt-1 text-[13px] leading-snug text-ink-dim">
      This decides how Zonadua sets your FTP — the number every TSS and IF figure divides by.
    </p>
  </div>

  <!-- Two options -->
  <div class="flex flex-col gap-2.5">
    <button
      type="button"
      onclick={() => pick(true)}
      class="rounded-2xl border p-3.5 text-left transition-colors {hasMeter === true
        ? 'bg-mono bg-mono-gradient border-transparent text-on-mono glow-mono'
        : 'bg-surface border-hairline'}"
    >
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <span class="text-[14px] font-extrabold tracking-tight {hasMeter === true ? 'text-on-mono' : 'text-ink'}">
            Yes — I have one
          </span>
          <span class="mt-0.5 block text-[12px] leading-snug {hasMeter === true ? 'text-on-mono-dim' : 'text-ink-dim'}">
            I can give a 20-minute best effort.
          </span>
        </div>
        <span
          class="grid h-5 w-5 shrink-0 place-items-center rounded-full {hasMeter === true
            ? 'bg-crimson-fill text-white'
            : 'bg-tile border border-hairline'}"
        >
          {#if hasMeter === true}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          {/if}
        </span>
      </div>
    </button>

    <button
      type="button"
      onclick={() => pick(false)}
      class="rounded-2xl border p-3.5 text-left transition-colors {hasMeter === false
        ? 'bg-mono bg-mono-gradient border-transparent text-on-mono glow-mono'
        : 'bg-surface border-hairline'}"
    >
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <span class="text-[14px] font-extrabold tracking-tight {hasMeter === false ? 'text-on-mono' : 'text-ink'}">
            No — not yet
          </span>
          <span class="mt-0.5 block text-[12px] leading-snug {hasMeter === false ? 'text-on-mono-dim' : 'text-ink-dim'}">
            Estimate it from my rides.
          </span>
        </div>
        <span
          class="grid h-5 w-5 shrink-0 place-items-center rounded-full {hasMeter === false
            ? 'bg-crimson-fill text-white'
            : 'bg-tile border border-hairline'}"
        >
          {#if hasMeter === false}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          {/if}
        </span>
      </div>
    </button>
  </div>

  {#if hasMeter === true}
    <!-- 20-minute entry -->
    <div class="flex flex-col gap-2.5">
      <MetricStepper label="20-min best effort" unit="W" bind:value={avgW} step={5} min={80} max={600} />
      <div class="rounded-2xl bg-tile border border-hairline px-3.5 py-3">
        <div class="flex items-baseline justify-between">
          <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-dim">Your FTP</span>
          <span class="text-[18px] font-extrabold text-ink text-tabular">
            {ftp !== null ? `${ftp} W` : '—'}
          </span>
        </div>
        <p class="mt-1 text-[11.5px] leading-snug text-ink-dim">
          95% of your 20-minute average — the standard estimate. Change it later in Settings.
        </p>
      </div>
    </div>
  {:else if hasMeter === false}
    <!-- Estimated-protocol card -->
    <div class="rounded-2xl bg-tile border border-hairline p-3.5">
      <span class="text-[10px] font-extrabold uppercase tracking-[0.14em] text-crimson-deep">
        Estimated protocol
      </span>
      <p class="mt-1 text-[12.5px] leading-snug text-ink-dim">
        No problem. Zonadua will estimate your threshold from your first rides — moving speed,
        elevation and cadence where available. Every figure derived from it is labelled
        <span class="font-bold text-ink">[ ESTIMATED ]</span> so you always know which numbers
        are measured and which are modelled. Log a real 20-minute test any time to upgrade.
      </p>
    </div>
  {/if}

  <button
    type="button"
    onclick={next}
    disabled={saving}
    class="h-12 w-full rounded-full bg-crimson-fill text-white text-[11px] font-extrabold uppercase tracking-[0.14em] active:scale-[0.98] disabled:opacity-60"
  >
    {saving ? 'Saving…' : hasMeter === true ? 'Save FTP & continue' : 'Continue'}
  </button>
</div>
