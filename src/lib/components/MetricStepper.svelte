<script lang="ts">
  /**
   * Numeric stepper used across onboarding. One control for every metric the rider sets with
   * +/− (mass, stature, birth year, heart rates, 20-minute power), so the steps feel like one
   * instrument rather than five different widgets.
   *
   * The readout doubles as a manual entry field: tap it and type. Without that, setting body
   * mass from 70 to 82.5 kg is twenty-five taps of a 0.5 kg stepper. Typed values are clamped
   * to the metric's range on commit (blur or Enter) but are NOT snapped to the arrow step —
   * 71.3 kg stays 71.3 kg, because a rider who typed a number meant that number. Metrics with
   * sub-unit steps (mass at 0.5) accept tenths and a comma as the decimal separator, since
   * many locales' numeric keyboards produce one; whole-number metrics round typed input.
   *
   * It is a controlled component: the parent owns the value and clamps it, because the valid
   * range differs per metric (a 40 bpm resting rate and a 40 kg mass are both "in range" of
   * the raw number but only one is a plausible answer to its own question).
   */
  let {
    label,
    unit,
    unitLabel = unit,
    value = $bindable(),
    step = 1,
    min,
    max,
    onDecrement,
    onIncrement
  }: {
    label: string;
    unit: string;
    /** Accessible unit for the entry field, when `unit` is a decorated display string. */
    unitLabel?: string;
    value: number;
    step?: number;
    min: number;
    max: number;
    onDecrement?: () => void;
    onIncrement?: () => void;
  } = $props();

  const atMin = $derived(value <= min);
  const atMax = $derived(value >= max);

  /** Sub-unit steps (mass at 0.5 kg) accept tenths; whole-number metrics reject them. */
  const decimals = $derived(step < 1 ? 1 : 0);
  const inputMode = $derived(decimals > 0 ? 'decimal' : 'numeric');

  /** How the numeric value reads in the field. */
  const shown = $derived(decimals > 0 ? String(value) : String(Math.round(value)));

  let focused = $state(false);
  let text = $state('');

  // Mirror the value into the field whenever it changes under us (arrows, a parent write,
  // async prefill) — but never while the rider is mid-keystroke.
  $effect(() => {
    if (!focused) text = shown;
  });

  function dec() {
    if (atMin) return;
    value = Math.max(min, Math.round((value - step) * 10) / 10);
    text = shown;
    onDecrement?.();
  }
  function inc() {
    if (atMax) return;
    value = Math.min(max, Math.round((value + step) * 10) / 10);
    text = shown;
    onIncrement?.();
  }

  /** Parse the field: comma or dot, snapped to the metric's precision, clamped to range. */
  function parseField(raw: string): number | null {
    const parsed = Number.parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(parsed)) return null;
    const snapped = decimals > 0 ? Math.round(parsed * 10) / 10 : Math.round(parsed);
    return Math.min(max, Math.max(min, snapped));
  }

  /**
   * Push the typed value out as it is typed, without rewriting the field.
   *
   * Committing only on blur left a hole: a rider who types and taps Continue in one motion
   * could have the save read `value` before the blur landed, silently keeping the previous
   * number. Updating on input closes it — the parent always sees the latest parseable value,
   * so the live preview tracks the keystrokes too. The text is left alone here, because
   * clamping an in-progress entry ("6" on the way to "66") would rewrite the field under
   * the rider's fingers; blur is what normalises the display.
   */
  function onfieldinput(e: Event): void {
    const next = parseField((e.currentTarget as HTMLInputElement).value);
    if (next !== null) value = next;
  }

  /** Finish an edit: normalise the display, or fall back to the last good value. */
  function commit(): void {
    focused = false;
    const next = parseField(text);
    value = next ?? value; // empty or garbage: keep the last good value
    text = shown;
  }

  function onfieldkey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      (e.currentTarget as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      text = shown;
      (e.currentTarget as HTMLInputElement).blur();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      inc();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      dec();
    }
  }
</script>

<div class="flex items-center justify-between gap-3 rounded-2xl bg-tile border border-hairline px-2 py-2">
  <button
    type="button"
    aria-label={`Decrease ${label}`}
    disabled={atMin}
    onclick={dec}
    class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface border border-hairline text-ink transition-colors disabled:opacity-30 active:scale-95"
  >
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <line x1="3.5" y1="8" x2="12.5" y2="8" />
    </svg>
  </button>

  <div class="flex min-w-0 flex-col items-center leading-none">
    <div class="flex items-baseline gap-1">
      <!--
        The readout is the manual entry field. Same type scale, tabular figures and colour as
        the span it replaced; the affordance is the project's standard input focus underline
        (signal), matching every other text field in the app.
      -->
      <input
        type="text"
        inputmode={inputMode}
        aria-label={`${label} in ${unitLabel}`}
        bind:value={text}
        onfocus={(e) => {
          focused = true;
          e.currentTarget.select();
        }}
        oninput={onfieldinput}
        onblur={commit}
        onkeydown={onfieldkey}
        class="w-[4.75ch] border-b-2 border-transparent bg-transparent p-0 text-center text-metric-lg text-ink text-tabular caret-signal outline-none focus:border-signal transition-colors"
      />
      <span class="text-[13px] font-bold text-ink-dim">{unit}</span>
    </div>
    <span class="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-dim">{label}</span>
  </div>

  <button
    type="button"
    aria-label={`Increase ${label}`}
    disabled={atMax}
    onclick={inc}
    class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface border border-hairline text-ink transition-colors disabled:opacity-30 active:scale-95"
  >
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <line x1="3.5" y1="8" x2="12.5" y2="8" />
      <line x1="8" y1="3.5" x2="8" y2="12.5" />
    </svg>
  </button>
</div>
