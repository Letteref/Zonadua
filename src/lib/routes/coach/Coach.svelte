<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import EditorialHeader from '$lib/components/EditorialHeader.svelte';
  import { db, type AiNote } from '$lib/data/db';
  import { newId } from '$lib/data/seed';
  import { appSettings, allActivities, latestFtp, athlete, weightSeries } from '$lib/data/queries.svelte';
  import { toast } from '$lib/toast.svelte';
import { generate } from '$lib/infra/ai/provider';
import { buildCoachContext } from '$lib/infra/ai/context';
import { buildWeeklyReview, verifyReview } from '$lib/infra/ai/review';

  let chatInput = $state('');
  let notes = $state<AiNote[]>([]);
  let review = $state<string | null>(null);
  let reviewLoading = $state(false);
  let reviewError = $state<string | null>(null);

  void (async () => {
    try {
      const rows = await db.ai_notes.where('kind').equals('chat').reverse().sortBy('createdAt');
      notes = rows.slice(0, 5);
    } catch (err) {
      console.error('[zonadua] coach load failed:', err);
      toast.error('Could not load your saved questions');
    }
  })();

  // F5-AC1: without a key the AI features stay behind onboarding; app stays fully functional
  const keySaved = $derived(appSettings.current?.aiKey != null);

  // Build context from this rider's data (no hallucination possible — only measured/derived)
  const coachContext = $derived(() => {
    const activities = allActivities.current;
    const ftp = latestFtp.current?.ftp;
    const ath = athlete.current;
    if (!activities || activities.length === 0) return null;

    const rides = activities
      .filter(a => a.synthetic !== true) // demo data must not influence coaching
      .map(a => ({
        date: a.date,
        distanceKm: a.distanceKm,
        elevGainM: a.elevGainM,
        movingSec: a.movingSec,
        tss: a.tss,
        np: a.np,
        synthetic: a.synthetic
      }));

    return buildCoachContext({
      rides,
      athlete: { weightKg: weightSeries.current?.at(-1)?.kg, ftp, heightCm: ath?.heightCm },
      now: new Date()
    });
  });

  // Generate weekly review on demand
  async function generateReview(): Promise<void> {
    if (reviewLoading) return;

    const ctx = coachContext();
    if (!ctx) {
      reviewError = 'No rides to review yet.';
      return;
    }

    reviewLoading = true;
    reviewError = null;

    try {
      const request = buildWeeklyReview(ctx);
      const response = await generate(request.prompt, request.system);

      // Checked against exactly what the model was shown — see review.ts for why the
      // prompt and the verification target cannot be swapped for the raw object.
      const result = verifyReview(request, response.text);

      if (!result.ok || result.text === null) {
        console.error('[zonadua] coach hallucinated:', result.ungrounded);
        reviewError = 'The coach invented numbers. This answer was blocked.';
        return;
      }

      review = result.text;
    } catch (err) {
      console.error('[zonadua] generateReview failed:', err);
      // A timeout aborts with a DOMException whose `.message` is the string
      // "signal timed out" — true, but it tells the rider nothing about what to do.
      const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
      reviewError = timedOut
        ? 'The provider did not answer in 45 seconds. Check your connection and try again.'
        : err instanceof Error
          ? err.message
          : 'Could not generate review';
    } finally {
      reviewLoading = false;
    }
  }

  // M5 wires the LLM call (BYO key, derived metrics only — Strava API Policy §5.3).
  async function sendChat(): Promise<void> {
    const q = chatInput.trim();
    if (!q) return;
    try {
      const note: AiNote = { id: newId(), kind: 'chat', content: q, createdAt: Date.now() };
      await db.ai_notes.put(note);
      notes = [note, ...notes].slice(0, 5);
      chatInput = '';
    } catch (err) {
      // the question stays in the box: clearing it on a failed write loses the only
      // thing the rider typed, and this screen has no other copy
      console.error('[zonadua] sendChat failed:', err);
      toast.error('Could not save your question');
    }
  }
</script>

<div class="flex flex-col gap-5 pb-6">
  <!-- Editorial header -->
  <header class="pt-8 px-5">
    <EditorialHeader
      kicker="AI coach"
      headline="Your data, coached"
      sub="Weekly reviews & plans built on —"
      accent="your derived metrics."
    />
  </header>

  <div class="px-5 flex flex-col gap-5">
    <!-- BYO key card -->
    <section class="rounded-card bg-surface border border-hairline p-4 elevation-card flex flex-col gap-4">
      <div class="flex items-start gap-4">
        <div class="h-12 w-12 rounded-pill bg-tile shrink-0 grid place-items-center border border-hairline">
          <Icon name="key-round" size={22} strokeWidth={1.5} class="text-aman" />
        </div>
        <div class="flex flex-col min-w-0">
          <h2 class="text-lg font-bold text-ink tracking-tight">Bring your own key</h2>
          <p class="text-[13px] leading-relaxed text-ink-dim mt-1">
            Your data is summarized into metrics on-device; only those summaries are sent to the model you choose.
          </p>
        </div>
      </div>
      <button
        class="h-11 w-full rounded-pill flex items-center justify-center gap-2 px-4 {keySaved
          ? 'bg-surface border border-hairline-strong text-ink'
          : 'bg-crimson-fill text-white'} font-extrabold uppercase text-[11px] tracking-wider {keySaved ? '' : 'glow-signal'} active:scale-[0.98] transition-transform"
        onclick={() => (window.location.hash = '#/settings')}
      >
        <Icon name="key-round" size={18} strokeWidth={1.5} />
        <span>{keySaved ? 'Manage API key in Settings' : 'Add API key'}</span>
      </button>
    </section>

    {#if keySaved}
    <!-- Weekly review: generated from this rider's data only -->
    <section class="rounded-card bg-surface border border-hairline p-4 elevation-card flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="h-10 w-10 rounded-pill bg-tile grid place-items-center border border-hairline">
            <Icon name="calendar" size={18} strokeWidth={1.5} class="text-ink" />
          </div>
          <h2 class="text-base font-bold text-ink tracking-tight">Weekly review</h2>
        </div>
        {#if !review && !reviewLoading}
          <button
            class="h-9 px-4 rounded-pill bg-crimson-fill text-white font-extrabold uppercase text-[10px] tracking-wider glow-peak active:scale-95 transition-transform"
            onclick={generateReview}
          >
            Generate
          </button>
        {/if}
      </div>

      {#if reviewLoading}
        <div class="flex items-center gap-3 py-4">
          <div class="animate-spin h-5 w-5 border-2 border-crimson-fill border-t-transparent rounded-full"></div>
          <span class="text-sm text-ink-dim">Reading your week…</span>
        </div>
      {:else if reviewError}
        <div class="rounded-pill bg-rose/10 border border-rose/30 px-4 py-3">
          <p class="text-xs text-rose font-medium">{reviewError}</p>
        </div>
      {:else if review}
        <div class="flex flex-col gap-2 text-[13px] leading-relaxed text-ink">
          {#each review.split('\n\n') as para}
            <p>{para}</p>
          {/each}
        </div>
        <button
          class="h-8 px-3 rounded-pill bg-surface border border-hairline text-ink-dim font-bold text-[10px] tracking-wider active:scale-95 transition-transform self-start"
          onclick={() => { review = null; reviewError = null; }}
        >
          Clear
        </button>
      {:else}
        <p class="text-[13px] text-ink-dim leading-relaxed">
          Generate a review of your last 7 days — built from your CTL, TSB, and ride history. No numbers are invented.
        </p>
      {/if}
    </section>

    <section class="flex flex-col gap-2">
      <div class="relative h-12 w-full rounded-pill bg-surface flex items-center pl-4 pr-1.5 elevation-card border border-hairline">
        <input
          class="w-full bg-transparent text-[13px] text-ink placeholder-ink-dim/60 focus:outline-none pr-2"
          placeholder="Save a question for later…"
          type="text"
          bind:value={chatInput}
          onkeydown={(e) => {
            if (e.key === 'Enter') void sendChat();
          }}
        />
        <button
          class="w-9 h-9 rounded-pill bg-crimson-fill shrink-0 grid place-items-center text-white glow-peak active:scale-90 transition-transform"
          aria-label="Save question"
          onclick={sendChat}
        >
          <Icon name="send" size={18} strokeWidth={1.5} />
        </button>
      </div>
      <p class="text-[11px] text-ink-dim text-center">Saved on this device only — nothing is sent, and nothing answers.</p>
      {#if notes.length > 0}
        <div class="flex flex-col gap-1.5 pt-1">
          {#each notes as n (n.id)}
            <div class="flex items-center justify-between gap-2 rounded-xl bg-tile border border-hairline px-3 py-2">
              <span class="text-[12px] text-ink-dim truncate">“{n.content}”</span>
              <button
                class="shrink-0 text-ink-dim hover:text-kritis transition-colors"
                aria-label="Delete note"
                onclick={async () => {
                  await db.ai_notes.delete(n.id);
                  notes = notes.filter((x) => x.id !== n.id);
                }}
              >
                <Icon name="x" size={14} strokeWidth={1.8} />
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </section>
    {:else}
    <!-- Locked: F5-AC1 — no AI behind a missing key, but the app stays fully usable -->
    <section class="rounded-card border border-dashed border-hairline-strong p-6 flex flex-col items-center text-center gap-2">
      <div class="grid h-11 w-11 place-items-center rounded-pill bg-tile border border-hairline text-ink-dim">
        <Icon name="lock" size={20} strokeWidth={1.5} />
      </div>
      <h2 class="text-sm font-extrabold tracking-tight text-ink">The weekly review needs your key</h2>
      <p class="text-[12px] text-ink-dim leading-relaxed max-w-[36ch]">
        Add your own API key and Zonadua will write a review of your last seven days, using
        only the metrics it derived on this device. Every other part of the app works without
        a key, and training plans and chat are still to come.
      </p>
      <button
        class="mt-1 h-10 px-5 rounded-pill bg-crimson-fill text-white text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-2 glow-signal active:scale-[0.98] transition-transform"
        onclick={() => (window.location.hash = '#/settings')}
      >
        <Icon name="key-round" size={15} strokeWidth={2} />
        Add API key
      </button>
    </section>
    {/if}

    <p class="text-center text-xs text-ink-dim">
      Coach context is built from derived metrics only (Strava API Policy §5.3).
    </p>
  </div>
</div>
