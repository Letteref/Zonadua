<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import EditorialHeader from '$lib/components/EditorialHeader.svelte';
    import { db, type AiNote } from '$lib/data/db';
  import { newId } from '$lib/data/seed';
  import { appSettings } from '$lib/data/queries.svelte';

  let chatInput = $state('');
  let notes = $state<AiNote[]>([]);

  void (async () => {
    try {
      const rows = await db.ai_notes.where('kind').equals('chat').reverse().sortBy('createdAt');
      notes = rows.slice(0, 5);
    } catch (err) {
      console.error('[zonadua] coach load failed:', err);
    }
  })();

  // F5-AC1: without a key the AI features stay behind onboarding; app stays fully functional
  const keySaved = $derived(appSettings.current?.aiKey != null);

  // M5 wires the LLM call (BYO key, derived metrics only — Strava API Policy §5.3).
  // Until then this only files the question locally. It never pretends an answer exists,
  // and nothing on this screen is derived from a literal: every number that used to sit
  // here was invented and none of it came from this rider.
  async function sendChat(): Promise<void> {
    const q = chatInput.trim();
    if (!q) return;
    try {
      const note: AiNote = { id: newId(), kind: 'chat', content: q, createdAt: Date.now() };
      await db.ai_notes.put(note);
      notes = [note, ...notes].slice(0, 5);
      chatInput = '';
    } catch (err) {
      console.error('[zonadua] sendChat failed:', err);
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
    <!--
      Key present, M5 not shipped.

      This branch used to render a weekly review, three insights, a next-week plan and a
      coaching answer, every one of them built from literals: `CTL 68`, `TSB +8`,
      `IF 0.68`, `Target 740 TSS`, `12%` above baseline, `3.1%` decoupling. None of it
      came from this rider, and all of it contradicted the dashboard, which reports the
      real CTL 23 / TSB -16. Worse, it appeared the moment an API key was saved — precisely
      when a user concludes the feature is live. `sendChat` answered nothing either: it
      wrote the question to `ai_notes` and returned.

      Fabricated numbers were removed rather than relabelled. A "sample" badge on a screen
      is still a number that can be read at 5am before a 200 km event, and this app has one
      rule about that: an unmeasurable thing renders as an honest state, never as a number
      that reads like data.

      What stays is the part that is real — questions the rider typed, stored locally. It
      now says plainly that nothing has answered them.
    -->
    <section class="rounded-card border border-dashed border-hairline-strong p-6 flex flex-col items-center text-center gap-2">
      <div class="grid h-11 w-11 place-items-center rounded-pill bg-tile border border-hairline text-ink-dim">
        <Icon name="message-circle" size={20} strokeWidth={1.5} />
      </div>
      <h2 class="text-sm font-extrabold tracking-tight text-ink">Coach has not shipped yet</h2>
      <p class="text-[12px] text-ink-dim leading-relaxed max-w-[36ch]">
        Your key is saved, but Zonadua does not generate reviews, plans or answers yet — that is M5.
        Nothing on this screen is made up in the meantime.
      </p>
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
      <h2 class="text-sm font-extrabold tracking-tight text-ink">Reviews, plans & chat are locked</h2>
      <p class="text-[12px] text-ink-dim leading-relaxed max-w-[36ch]">
        Add your own API key to unlock the weekly review, training plans and the coach chat — everything else in Zonadua works without it.
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
      Coach ships in M5 — context is built from derived metrics only (Strava API Policy §5.3).
    </p>
  </div>
</div>
