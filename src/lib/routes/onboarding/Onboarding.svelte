<script lang="ts">
  /**
   * First-run onboarding — five skippable steps in one full-viewport shell.
   *
   * The shell owns the step machine, the progress bar, the shared header (mark + Skip) and
   * the bottom action pair. Each step is a child that owns only its own inputs and preview;
   * the shell hands it a `next` callback to advance. Answers are written to the real tables
   * on Continue (see onboarding.svelte.ts), so nothing is lost if the rider closes the tab.
   *
 * Every step is skippable — the bottom "Skip" moves past the current step only, and the
 * header "Skip setup" abandons the flow entirely — because a rider with no scale, no monitor
 * or no power meter must still be able to reach their dashboard. Skipping never writes a
 * guess; it just moves on.
   */
  import Logo from '$lib/components/Logo.svelte';
  import StepBiometrics from './steps/StepBiometrics.svelte';
  import StepHeartRate from './steps/StepHeartRate.svelte';
  import StepPowerMeter from './steps/StepPowerMeter.svelte';
  import StepExperience from './steps/StepExperience.svelte';
  import StepStrava from './steps/StepStrava.svelte';
  import {
    ONBOARDING_STEPS,
    draftStep,
    markOnboarded,
    saveDraftStep
  } from '$lib/data/onboarding.svelte';

  let { ondone }: { ondone: () => void } = $props();

  let step = $state(draftStep());

  const stepLabel = $derived(`Step ${step + 1} of ${ONBOARDING_STEPS}`);

  function advance(): void {
    if (step < ONBOARDING_STEPS - 1) {
      step += 1;
      saveDraftStep(step);
    } else {
      finish();
    }
  }

  function back(): void {
    if (step > 0) {
      step -= 1;
      saveDraftStep(step);
    }
  }

  /** Finish — reached by the last Continue or by the header "Skip setup". Never writes a guessed answer. */
  function finish(): void {
    markOnboarded();
    ondone();
  }
</script>

<div class="fixed inset-0 z-40 flex flex-col bg-canvas">
  <!-- Header: mark + wordmark, step counter, Skip -->
  <header class="flex shrink-0 items-center justify-between gap-3 px-5 pt-5 pb-3">
    <div class="flex items-center gap-2">
      <Logo size={26} />
      <span class="text-[15px] font-extrabold uppercase tracking-[0.14em] text-ink">Zonadua</span>
    </div>
    <div class="flex items-center gap-3">
      <span class="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-dim">{stepLabel}</span>
      <button
        type="button"
        onclick={finish}
        class="text-[10px] font-extrabold uppercase tracking-[0.12em] text-crimson-deep active:opacity-70"
      >
        Skip setup
      </button>
    </div>
  </header>

  <!-- Progress: five segments -->
  <div class="flex shrink-0 gap-1.5 px-5 pb-4">
    {#each Array(ONBOARDING_STEPS) as _, i (i)}
      <div
        class="h-1 flex-1 rounded-full transition-colors {i <= step ? 'bg-crimson-fill' : 'bg-hairline-strong'}"
      ></div>
    {/each}
  </div>

  <!-- Step body -->
  <main class="min-h-0 flex-1 overflow-y-auto px-5">
    {#if step === 0}
      <StepBiometrics onnext={advance} />
    {:else if step === 1}
      <StepHeartRate onnext={advance} />
    {:else if step === 2}
      <StepPowerMeter onnext={advance} />
    {:else if step === 3}
      <StepExperience onnext={advance} />
    {:else}
      <StepStrava ondone={finish} />
    {/if}
  </main>

  <!-- Bottom actions: back + skip (last step hides them; it owns its own finish) -->
  {#if step < ONBOARDING_STEPS - 1}
    <footer class="flex shrink-0 items-center gap-3 px-5 pt-3 pb-8">
      {#if step > 0}
        <button
          type="button"
          onclick={back}
          class="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-tile border border-hairline text-ink active:scale-95"
          aria-label="Previous step"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4 6 9l5 5" />
          </svg>
        </button>
      {/if}
      <button
        type="button"
        onclick={advance}
        class="h-12 flex-1 rounded-full bg-tile border border-hairline text-ink-dim text-[11px] font-extrabold uppercase tracking-[0.14em] active:scale-[0.98]"
      >
        Skip
      </button>
    </footer>
  {/if}
</div>
