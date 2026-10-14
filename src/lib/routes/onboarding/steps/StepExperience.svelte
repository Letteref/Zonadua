<script lang="ts">
  /**
   * Step 4 — experience archetype and weekly volume target.
   *
   * Three archetypes set the tone for how Zonadua talks to the rider and what it treats as a
   * normal week; picking one also pre-fills a sensible weekly distance, which the rider can
   * then nudge with the slider. Both answers land on the settings row and are used by the
   * dashboard's weekly-target card as the baseline before any ride history exists to derive
   * one from.
   */
  import { savePlan } from '$lib/data/onboarding.svelte';
  import { ARCHETYPES, archetype, volumePlan, type ArchetypeKey } from '$lib/domain/onboarding';
  import { toast } from '$lib/toast.svelte';

  let { onnext }: { onnext: () => void } = $props();

  let selected = $state<ArchetypeKey>('structured');
  let weeklyKm = $state(archetype('structured').defaultKm);
  let saving = $state(false);

  const plan = $derived(volumePlan(weeklyKm));

  function pick(key: ArchetypeKey) {
    selected = key;
    weeklyKm = archetype(key).defaultKm; // re-fill the slider to the new tier's baseline
  }

  async function next() {
    saving = true;
    try {
      await savePlan({ archetype: selected, weeklyTargetKm: weeklyKm });
      onnext();
    } catch (err) {
      console.error('[zonadua] onboarding plan failed:', err);
      toast.error('Could not save your plan — check again');
    } finally {
      saving = false;
    }
  }
</script>

<div class="flex flex-col gap-4 pb-4">
  <div>
    <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-crimson-deep">Training</span>
    <h1 class="mt-1 text-[22px] font-extrabold leading-tight tracking-tight text-ink">
      Where are you riding from?
    </h1>
    <p class="mt-1 text-[13px] leading-snug text-ink-dim">
      Sets the tone for your coaching and a starting weekly target. Tune either later in Settings.
    </p>
  </div>

  <!-- Archetype picker -->
  <div class="flex flex-col gap-2.5">
    {#each ARCHETYPES as a (a.key)}
      <button
        type="button"
        onclick={() => pick(a.key)}
        class="rounded-2xl border p-3.5 text-left transition-colors {selected === a.key
          ? 'bg-mono bg-mono-gradient border-transparent text-on-mono glow-mono'
          : 'bg-surface border-hairline'}"
      >
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <span class="text-[14px] font-extrabold tracking-tight {selected === a.key ? 'text-on-mono' : 'text-ink'}">
              {@html a.title}
            </span>
            <span class="mt-0.5 block text-[10px] font-bold uppercase tracking-[0.12em] {selected === a.key ? 'text-on-mono-dim' : 'text-ink-dim'}">
              {a.tagline}
            </span>
          </div>
          <span
            class="grid h-5 w-5 shrink-0 place-items-center rounded-full {selected === a.key
              ? 'bg-crimson-fill text-white'
              : 'bg-tile border border-hairline'}"
          >
            {#if selected === a.key}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            {/if}
          </span>
        </div>
        <p class="mt-1.5 text-[12px] leading-snug {selected === a.key ? 'text-on-mono-dim' : 'text-ink-dim'}">
          {a.blurb}
        </p>
      </button>
    {/each}
  </div>

  <!-- Weekly volume target -->
  <div class="rounded-2xl bg-tile border border-hairline p-3.5">
    <div class="flex items-end justify-between">
      <div class="flex items-baseline gap-1.5">
        <span class="text-[26px] font-extrabold leading-none tracking-tight text-ink text-tabular">{weeklyKm}</span>
        <span class="text-[13px] font-bold text-ink-dim">km / week</span>
      </div>
      <span class="text-[11px] font-bold text-ink-dim">
        {plan ? `~${plan.hoursPerWeek} h · ${plan.ridesPerWeek} rides` : ''}
      </span>
    </div>
    <input
      type="range"
      min="40"
      max="350"
      step="10"
      bind:value={weeklyKm}
      aria-label="Weekly distance target in kilometres"
      class="mt-3 w-full accent-[var(--color-crimson-fill)]"
    />
    <div class="mt-1 flex justify-between text-[10px] font-bold uppercase tracking-[0.1em] text-ink-dim">
      <span>40 km</span>
      <span>350 km</span>
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
