<script lang="ts">
  import EditorialHeader from '$lib/components/EditorialHeader.svelte';
  import {
    KeyRound,
    TrendingUp,
    Bolt,
    ShieldCheck,
    MessageCircle,
    CalendarPlus,
    Send,
    Check,
    Circle,
    X,
    Lock
  } from '@lucide/svelte';
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
      console.error('[gowslab] coach load failed:', err);
    }
  })();

  // F5-AC1: without a key the AI features stay behind onboarding; app stays fully functional
  const keySaved = $derived(appSettings.current?.aiKey != null);

  // M5 wires the LLM call (BYO key, derived metrics only — Strava API Policy §5.3);
  // today the question is stored as a note so the data model is already live.
  async function sendChat(): Promise<void> {
    const q = chatInput.trim();
    if (!q) return;
    try {
      const note: AiNote = { id: newId(), kind: 'chat', content: q, createdAt: Date.now() };
      await db.ai_notes.put(note);
      notes = [note, ...notes].slice(0, 5);
      chatInput = '';
    } catch (err) {
      console.error('[gowslab] sendChat failed:', err);
    }
  }

  const miniTiles: { label: string; value: string; tone: 'ink' | 'signal' | 'aman'; chip?: string }[] = [
    { label: 'Time', value: '8h 32m', tone: 'ink' },
    { label: 'Stress', value: '512 TSS', tone: 'signal' },
    { label: 'Polarity', value: '82% Z1-Z2', tone: 'aman' },
    { label: 'Form', value: 'TSB +8', tone: 'ink', chip: 'AMAN' }
  ];

  const insights = [
    {
      icon: TrendingUp,
      tone: 'text-aman',
      parts: [
        { t: 'Your TSS is ' },
        { t: '12%', strong: true },
        { t: ' above your 4-week baseline while TSB holds steady (' },
        { t: '+8', accent: true },
        { t: ') — this block is progressing; hold one more week prior to scheduled regeneration.' }
      ]
    },
    {
      icon: Bolt,
      tone: 'text-signal',
      parts: [
        { t: 'Aerobic decoupling (Pw:HR) registered ' },
        { t: '3.1%', strong: true },
        { t: " on Saturday's 112 km endurance mission, proving solid drift resilience across steady Zone 2 tempo." }
      ]
    },
    {
      icon: ShieldCheck,
      tone: 'text-aman',
      parts: [
        { t: 'Autonomic recovery indicators aligned cleanly with Tuesday’s CP threshold output (' },
        { t: '275 W', strong: true },
        { t: ' targeted), pinning cumulative physiological strain firmly at ' },
        { t: 'AMAN', accent: true },
        { t: '.' }
      ]
    }
  ];

  const weekDays = [
    { d: 'M', today: false, session: { name: 'Rest Day', meta: 'Recovery · 0m', tss: 0, done: true, rest: true } },
    { d: 'T', today: false, session: { name: 'Threshold Intervals', meta: 'Intervals · 1h 15m', tss: 96, done: true, rest: false } },
    { d: 'W', today: true, session: { name: 'Endurance Spin', meta: 'Endurance · 1h 45m', tss: 101, done: false, rest: false } },
    { d: 'T', today: false, session: { name: 'Commute + Tempo', meta: 'Tempo · 0h 45m', tss: 48, done: false, rest: false } },
    { d: 'F', today: false, session: { name: 'Recovery Spin', meta: 'Recovery · 0h 40m', tss: 24, done: false, rest: false } },
    { d: 'S', today: false, session: { name: 'Long Ride', meta: 'Endurance · 5h 30m', tss: 312, done: false, rest: false } },
    { d: 'S', today: false, session: { name: 'Rest Day', meta: 'Recovery · 0m', tss: 0, done: false, rest: true } }
  ];
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
          <KeyRound size={22} strokeWidth={1.5} class="text-aman" />
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
        <KeyRound size={18} strokeWidth={1.5} />
        <span>{keySaved ? 'Manage API key in Settings' : 'Add API key'}</span>
      </button>
    </section>

    {#if keySaved}
    <!-- Weekly review (M5 generates the real text; layout per UI-SPEC §4.9) -->
    <section class="rounded-card bg-surface border border-hairline p-4 elevation-card flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-dim">Week 38 · Review</span>
        <span class="text-[11px] font-bold uppercase tracking-widest text-ink-dim text-tabular">18 – 24 SEP</span>
      </div>
      <div class="grid grid-cols-2 gap-2">
        {#each miniTiles as tile (tile.label)}
          <div class="relative bg-tile rounded-2xl p-3 flex flex-col justify-between border border-hairline">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-extrabold text-ink-dim uppercase tracking-wider">{tile.label}</span>
              {#if tile.chip}
                <span class="px-1.5 py-0.5 rounded-pill bg-aman/10 text-aman text-[9px] font-extrabold uppercase">{tile.chip}</span>
              {/if}
            </div>
            <span class="text-lg font-bold text-tabular mt-1 {tile.tone === 'signal' ? 'text-crimson-deep' : tile.tone === 'aman' ? 'text-aman' : 'text-ink'}">
              {tile.value}
            </span>
          </div>
        {/each}
      </div>
      <div class="w-full border-t border-dashed border-hairline my-0.5"></div>
      <div class="flex flex-col gap-3">
        {#each insights as ins, i (i)}
          <div class="flex items-start gap-3">
            <div class="w-7 h-7 rounded-lg bg-tile shrink-0 grid place-items-center mt-0.5 border border-hairline">
              <ins.icon size={18} strokeWidth={1.5} class={ins.tone} />
            </div>
            <p class="text-[13px] text-ink leading-relaxed min-w-0">
              {#each ins.parts as part (part.t)}
                {#if part.strong}<strong class="text-ink font-semibold text-tabular">{part.t}</strong
                >{:else if part.accent}<span class="text-aman font-semibold text-tabular">{part.t}</span
                >{:else}{part.t}{/if}
              {/each}
            </p>
          </div>
          {#if i < insights.length - 1}
            <div class="w-full border-t border-dashed border-hairline/70"></div>
          {/if}
        {/each}
      </div>
    </section>

    <!-- Quick actions -->
    <div class="grid grid-cols-2 gap-2">
      <button class="h-12 rounded-pill bg-crimson-fill flex items-center justify-center gap-2 px-3 text-white font-extrabold uppercase text-[11px] tracking-wider glow-signal active:scale-95 transition-transform">
        <MessageCircle size={18} strokeWidth={1.5} />
        <span class="truncate">Ask coach</span>
      </button>
      <button class="h-12 rounded-pill bg-surface flex items-center justify-center gap-2 px-3 text-ink font-bold uppercase text-[11px] tracking-wider border border-hairline-strong active:scale-95 transition-transform">
        <CalendarPlus size={18} strokeWidth={1.5} class="text-signal" />
        <span class="truncate">Build next week</span>
      </button>
    </div>

    <!-- Chat mock -->
    <section class="flex flex-col gap-3">
      <div class="flex justify-end pl-10">
        <div class="rounded-2xl rounded-br-xs p-3.5 bg-raised border border-signal/50 text-ink font-bold text-sm leading-snug">
          Can I do a 6h ride Sunday and still recover before the event?
        </div>
      </div>
      <div class="flex justify-start pr-8">
        <div class="relative rounded-2xl rounded-bl-xs p-4 bg-surface text-ink flex flex-col gap-3 elevation-card border border-hairline-strong">
          <p class="text-sm text-ink leading-relaxed">
            Yes, but cap intensity at <strong class="text-crimson-deep font-semibold text-tabular">IF 0.68</strong>.
            Based on your current baseline, a 300 TSS day pulls form down to negative balance by Tuesday,
            leaving 5 full days to bounce back before race roll-out.
          </p>
          <div class="flex flex-wrap gap-1.5 pt-0.5">
            <span class="inline-flex items-center px-2 py-0.5 rounded-pill bg-raised border border-hairline-strong text-[11px] font-bold text-tabular text-ink-dim">CTL 68</span>
            <span class="inline-flex items-center px-2 py-0.5 rounded-pill bg-raised border border-hairline-strong text-[11px] font-bold text-tabular text-aman">TSB +8</span>
            <span class="inline-flex items-center px-2 py-0.5 rounded-pill bg-raised border border-hairline-strong text-[11px] font-bold text-tabular text-crimson-deep">Sun plan 300 TSS</span>
          </div>
        </div>
      </div>
      <div class="relative h-12 w-full rounded-pill bg-surface flex items-center pl-4 pr-1.5 elevation-card border border-hairline">
        <input
          class="w-full bg-transparent text-[13px] text-ink placeholder-ink-dim/60 focus:outline-none pr-2"
          placeholder="Ask intervals, pacing, taper..."
          type="text"
          bind:value={chatInput}
          onkeydown={(e) => {
            if (e.key === 'Enter') void sendChat();
          }}
        />
        <button
          class="w-9 h-9 rounded-pill bg-crimson-fill shrink-0 grid place-items-center text-white glow-peak active:scale-90 transition-transform"
          aria-label="Send query"
          onclick={sendChat}
        >
          <Send size={18} strokeWidth={1.5} />
        </button>
      </div>
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
                <X size={14} strokeWidth={1.8} />
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Next week plan -->
    <section class="rounded-card bg-surface border border-hairline p-4 elevation-card flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-dim">Next week</span>
        <span class="text-[10px] font-extrabold text-aman bg-aman/10 px-2 py-0.5 rounded-pill uppercase">Target 740 TSS</span>
      </div>
      <div class="flex items-center justify-between pt-1 px-2">
        {#each weekDays as wd, i (i)}
          <div class="flex flex-col items-center gap-1">
            <div
              class="w-9 h-9 rounded-pill grid place-items-center text-[11px] font-bold {wd.today
                ? 'bg-crimson-fill text-white font-extrabold glow-peak'
                : 'bg-raised text-ink-dim border border-hairline-strong'}"
            >
              {wd.d}
            </div>
          </div>
        {/each}
      </div>
      <div class="flex flex-col">
        {#each weekDays as wd, i (i)}
          <div class="py-2.5 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2.5 min-w-0">
              <span class="text-[10px] font-extrabold text-ink-dim uppercase w-6">{['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'][i]}</span>
              <div class="flex flex-col min-w-0">
                <span class="text-[13px] font-semibold truncate {wd.session.rest ? 'text-ink-dim line-through' : wd.today ? 'text-ink' : 'text-ink-dim'}">
                  {wd.session.name}
                </span>
                <span class="text-[9px] uppercase tracking-wider text-ink-dim">{wd.session.meta}</span>
              </div>
            </div>
            <div class="flex items-center gap-3 shrink-0">
              <span class="text-xs text-tabular {wd.session.tss === 0 ? 'text-ink-dim' : 'text-ink'}">{wd.session.tss} TSS</span>
              {#if wd.session.done}
                <span class="w-5 h-5 rounded-md bg-crimson-fill grid place-items-center">
                  <Check size={15} strokeWidth={2} class="text-white" />
                </span>
              {:else}
                <Circle size={20} strokeWidth={1.5} class="text-ink-dim" />
              {/if}
            </div>
          </div>
          {#if i < weekDays.length - 1}
            <div class="w-full border-t border-dashed border-hairline"></div>
          {/if}
        {/each}
      </div>
    </section>
    {:else}
    <!-- Locked: F5-AC1 — no AI behind a missing key, but the app stays fully usable -->
    <section class="rounded-card border border-dashed border-hairline-strong p-6 flex flex-col items-center text-center gap-2">
      <div class="grid h-11 w-11 place-items-center rounded-pill bg-tile border border-hairline text-ink-dim">
        <Lock size={20} strokeWidth={1.5} />
      </div>
      <h2 class="text-sm font-extrabold tracking-tight text-ink">Reviews, plans & chat are locked</h2>
      <p class="text-[12px] text-ink-dim leading-relaxed max-w-[36ch]">
        Add your own API key to unlock the weekly review, training plans and the coach chat — everything else in GowsLab works without it.
      </p>
      <button
        class="mt-1 h-10 px-5 rounded-pill bg-crimson-fill text-white text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-2 glow-signal active:scale-[0.98] transition-transform"
        onclick={() => (window.location.hash = '#/settings')}
      >
        <KeyRound size={15} strokeWidth={2} />
        Add API key
      </button>
    </section>
    {/if}

    <p class="text-center text-xs text-ink-dim">
      Coach ships in M5 — context is built from derived metrics only (Strava API Policy §5.3).
    </p>
  </div>
</div>
