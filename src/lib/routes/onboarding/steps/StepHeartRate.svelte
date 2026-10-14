<script lang="ts">
  /**
   * Step 2 — heart rate: resting (RHR) and maximum (HRmax).
   *
   * The coach-pass card is the point of this step. Many riders have no monitor and no recent
   * ramp test, and a form that implies these are required pushes them into inventing numbers.
   * So the card states plainly that skipping is safe, what Zonadua falls back to, and the
   * inputs stay optional — the rider can Continue without touching them.
   *
   * HRmax offers a Tanaka estimate (208 − 0.7 × age) pre-filled from the birth year given in
   * step 1, labelled an estimate so it is never mistaken for a measured ceiling.
   */
  import MetricStepper from '$lib/components/MetricStepper.svelte';
  import { loadAthlete, saveHeartRate } from '$lib/data/onboarding.svelte';
  import { hrReserve, tanakaHrMax, ageFromBirthYear } from '$lib/domain/onboarding';
  import { toast } from '$lib/toast.svelte';

  let { onnext }: { onnext: () => void } = $props();

  let restingHr = $state(55);
  let maxHr = $state(190);
  let loaded = $state(false);
  let saving = $state(false);

  loadAthlete()
    .then((a) => {
      if (a.restingHr && a.restingHr > 0) restingHr = a.restingHr;
      if (a.maxHr && a.maxHr > 0) {
        maxHr = a.maxHr;
      } else {
        // No stored ceiling yet: offer the Tanaka estimate for the birth year from step 1.
        const y = Number.parseInt((a.birthDate ?? '').slice(0, 4), 10);
        const age = ageFromBirthYear(y);
        const est = age !== null ? tanakaHrMax(age) : null;
        if (est !== null) maxHr = est;
      }
    })
    .catch(() => {})
    .finally(() => (loaded = true));

  const reserve = $derived(hrReserve(restingHr, maxHr));

  async function next() {
    saving = true;
    try {
      await saveHeartRate({ restingHr, maxHr });
      onnext();
    } catch (err) {
      console.error('[zonadua] onboarding heart rate failed:', err);
      toast.error('Could not save your heart rates — check again');
    } finally {
      saving = false;
    }
  }
</script>

<div class="flex flex-col gap-4 pb-4">
  <div>
    <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-crimson-deep">Heart</span>
    <h1 class="mt-1 text-[22px] font-extrabold leading-tight tracking-tight text-ink">
      Resting &amp; maximum heart rate
    </h1>
    <p class="mt-1 text-[13px] leading-snug text-ink-dim">
      Used to sanity-check training load and flag fatigue spikes. Optional.
    </p>
  </div>

  <!-- Coach pass: the safe-to-bypass card -->
  <div class="rounded-2xl bg-tile border border-hairline p-3.5">
    <div class="flex items-start gap-3">
      <div class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-crimson-fill text-white">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <div class="min-w-0">
        <span class="text-[10px] font-extrabold uppercase tracking-[0.14em] text-crimson-deep">Safe to bypass</span>
        <p class="mt-0.5 text-[12.5px] leading-snug text-ink-dim">
          No chest strap or wrist monitor? No problem. Zonadua will tune your zones off power
          output and perceived exertion instead. You can add these later once you have a clean
          morning reading or a ramp-test result.
        </p>
      </div>
    </div>
  </div>

  <div class="flex flex-col gap-2.5 {loaded ? '' : 'opacity-60'}">
    <MetricStepper label="Resting HR" unit="bpm" bind:value={restingHr} step={1} min={30} max={110} />
    <MetricStepper label="Max HR" unit="bpm" bind:value={maxHr} step={1} min={120} max={230} />
  </div>

  <!-- Reserve readout: the one dark monolith on this step -->
  <div class="rounded-2xl bg-mono bg-mono-gradient p-4 text-on-mono glow-mono">
    <div class="flex items-center justify-between">
      <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-on-mono-dim">Training reserve</span>
      <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-on-mono-dim">HRmax − RHR</span>
    </div>
    <div class="mt-3 flex items-end justify-between">
      <div class="flex items-baseline gap-1.5">
        <span class="text-[40px] font-extrabold leading-none tracking-tight text-tabular">
          {reserve !== null ? reserve : '—'}
        </span>
        <span class="text-[13px] font-bold text-on-mono-dim">bpm</span>
      </div>
      <span class="text-[13px] font-bold text-on-mono">
        {restingHr} → {maxHr}
      </span>
    </div>
  </div>

  <button
    type="button"
    onclick={next}
    disabled={saving}
    class="h-12 w-full rounded-full bg-crimson-fill text-white text-[11px] font-extrabold uppercase tracking-[0.14em] active:scale-[0.98] disabled:opacity-60"
  >
    {saving ? 'Saving…' : 'Continue'}
  </button>
</div>
