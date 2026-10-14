<script lang="ts">
  /**
   * Step 5 — Strava connect.
   *
   * Reuses the exact connect path Settings uses, including the honest "not configured" refusal
   * when the deployment was built without a client id — a new rider must not be shown a
   * button that dead-ends. This step is the end of the flow, so it owns its own finish: both
   * "Connect" (which navigates away to Strava) and "Skip" land the rider in the dashboard.
   */
  import { startStravaConnect } from '$lib/infra/strava/connect';
  import { toast } from '$lib/toast.svelte';

  let { ondone }: { ondone: () => void } = $props();

  let connecting = $state(false);

  async function connect() {
    connecting = true;
    const r = await startStravaConnect();
    if (!r.ok) {
      // Same words Settings uses, so the refusal reads identically wherever it is hit.
      toast.error('Strava is not configured on this deployment yet');
      connecting = false;
      // Stay on this step: the rider can still finish, and the message told them why the
      // button did nothing.
    }
    // On ok the browser is navigating to Strava; the callback lands back on `/`.
  }
</script>

<div class="flex flex-col gap-4 pb-4">
  <div>
    <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-crimson-deep">Sync</span>
    <h1 class="mt-1 text-[22px] font-extrabold leading-tight tracking-tight text-ink">
      Connect Strava
    </h1>
    <p class="mt-1 text-[13px] leading-snug text-ink-dim">
      Rides pull in on their own. Every figure — NP/IF/TSS, fitness, power curve — is derived
      from them, so this is what makes the dashboard real.
    </p>
  </div>

  <!-- What connecting does: the dark monolith on this step -->
  <div class="rounded-2xl bg-mono bg-mono-gradient p-4 text-on-mono glow-mono">
    <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-on-mono-dim">What it does</span>
    <ul class="mt-2.5 flex flex-col gap-2">
      {#each [
        'Rides sync automatically after you ride',
        'Authorization stays on this device only',
        'Zonadua never uploads, edits or deletes in Strava',
        'File import still works for rides Strava lacks'
      ] as line (line)}
        <li class="flex items-start gap-2.5">
          <span class="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-crimson-fill text-white">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </span>
          <span class="text-[12.5px] leading-snug text-on-mono">{line}</span>
        </li>
      {/each}
    </ul>
  </div>

  <div class="flex flex-col gap-2.5">
    <button
      type="button"
      onclick={connect}
      disabled={connecting}
      class="h-12 w-full rounded-full bg-crimson-fill text-white text-[11px] font-extrabold uppercase tracking-[0.14em] active:scale-[0.98] disabled:opacity-60"
    >
      {connecting ? 'Opening Strava…' : 'Connect Strava'}
    </button>
    <button
      type="button"
      onclick={ondone}
      class="h-12 w-full rounded-full bg-tile border border-hairline text-ink-dim text-[11px] font-extrabold uppercase tracking-[0.14em] active:scale-[0.98]"
    >
      Skip — import files instead
    </button>
  </div>

  <p class="text-center text-[11.5px] leading-snug text-ink-dim">
    You can connect any time from Settings. Everything stays on this device.
  </p>
</div>
