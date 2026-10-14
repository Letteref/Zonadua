<script lang="ts">
  /**
   * Step 1 — body biometrics: mass, stature, birth year.
   *
   * The card below the inputs is a live physics preview: as the rider moves mass, the
   * standard-FTP yield in W/kg and the category it maps to update in real time. The FTP
   * shown is a fixed standard (250 W) until the rider logs their own in step 3, so the
   * preview is honest about being a reference, not a measurement.
   */
  import MetricStepper from '$lib/components/MetricStepper.svelte';
  import { loadAthlete, saveBiometrics } from '$lib/data/onboarding.svelte';
  import { PREVIEW_FTP_W, ageFromBirthYear, wattsPerKg, wkgCategory } from '$lib/domain/onboarding';
  import { toast } from '$lib/toast.svelte';

  let { onnext }: { onnext: () => void } = $props();

  let weightKg = $state(70);
  let heightCm = $state(172);
  let birthYear = $state(1990);
  let loaded = $state(false);
  let saving = $state(false);

  // Seed the steppers from anything already on the athlete row, so re-running setup shows
  // the rider's real answers rather than the defaults.
  loadAthlete()
    .then((a) => {
      if (a.heightCm > 0) heightCm = a.heightCm;
      const y = Number.parseInt((a.birthDate ?? '').slice(0, 4), 10);
      if (Number.isFinite(y) && y > 1900) birthYear = y;
    })
    .catch(() => {})
    .finally(() => (loaded = true));

  const age = $derived(ageFromBirthYear(birthYear));
  const wkg = $derived(wattsPerKg(PREVIEW_FTP_W, weightKg));
  const category = $derived(wkg !== null ? wkgCategory(wkg) : null);

  async function next() {
    saving = true;
    try {
      await saveBiometrics({ weightKg, heightCm, birthYear });
      onnext();
    } catch (err) {
      console.error('[zonadua] onboarding biometrics failed:', err);
      toast.error('Could not save your details — check again');
    } finally {
      saving = false;
    }
  }
</script>

<div class="flex flex-col gap-4 pb-4">
  <div>
    <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-crimson-deep">Body</span>
    <h1 class="mt-1 text-[22px] font-extrabold leading-tight tracking-tight text-ink">
      Your baseline physics
    </h1>
    <p class="mt-1 text-[13px] leading-snug text-ink-dim">
      Mass, stature and birth year drive every W/kg and climbing figure in the app. Edit them any time in Settings.
    </p>
  </div>

  <div class="flex flex-col gap-2.5 {loaded ? '' : 'opacity-60'}">
    <MetricStepper label="Body mass" unit="kg" bind:value={weightKg} step={0.5} min={30} max={200} />
    <MetricStepper label="Stature" unit="cm" bind:value={heightCm} step={1} min={120} max={230} />
    <MetricStepper label="Birth year" unit={age !== null ? `· age ${age}` : 'year'} unitLabel="year" bind:value={birthYear} step={1} min={1920} max={new Date().getFullYear()} />
  </div>

  <!-- Live physics preview: the one dark monolith on this step -->
  <div class="rounded-2xl bg-mono bg-mono-gradient p-4 text-on-mono glow-mono">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-on-mono-dim">Physics preview</span>
        <span class="h-1.5 w-1.5 rounded-full bg-crimson"></span>
      </div>
      <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-on-mono-dim">Standard FTP</span>
    </div>
    <div class="mt-3 flex items-end justify-between">
      <div class="flex items-baseline gap-1.5">
        <span class="text-[40px] font-extrabold leading-none tracking-tight text-tabular">
          {wkg !== null ? wkg.toFixed(2) : '—'}
        </span>
        <span class="text-[13px] font-bold text-on-mono-dim">W/kg</span>
      </div>
      <div class="text-right">
        <span class="text-[13px] font-bold text-on-mono">{category ? category.label : '—'}</span>
        <span class="block text-[10px] uppercase tracking-[0.12em] text-on-mono-dim">{PREVIEW_FTP_W} W reference</span>
      </div>
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
