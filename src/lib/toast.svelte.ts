/**
 * One toast for the whole app.
 *
 * ## Why this file exists
 *
 * Three routes each grew their own `showToast`: Rides 3400 ms, Routes 3400 ms with a
 * `sticky` flag, Settings 3000 ms. That drift was not a style choice — it was three
 * copies of one idea that never met. Worse, every one of them rendered the *same*
 * green check for a *failed* write, so "Backup failed" came up looking exactly like
 * "Zones saved". A rider who is told a save worked when it did not will stop trying,
 * and the data is gone.
 *
 * So the store owns two things no route should re-decide: the tone (which decides the
 * glyph and the colour) and the lifetime (sticky for work in progress, 3.4 s for a
 * confirmation, 6 s for a failure — long enough to read "Could not log FTP" once).
 *
 * ## No silent failures
 *
 * Every `catch` that reaches Dexie now logs *and* raises an error tone, so no code path
 * can quietly swallow a failed write and leave the rider believing it landed. The store
 * itself deliberately offers no "log and forget" helper: the tone is chosen at each call
 * site precisely so nobody can file a failure under the confirmation styling again.
 */
export type ToastTone = 'ok' | 'error' | 'busy';

/** ms a success message stays up. Matches the two routes that agreed on it. */
const OK_MS = 3400;
/** ms a failure stays up: roughly twice a confirmation, because it must be read. */
const ERROR_MS = 6000;

export interface Toast {
  text: string;
  tone: ToastTone;
}

let current = $state<Toast | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

/** `ms: null` means sticky — no timer at all, rather than a setTimeout that overflows. */
function show(text: string, tone: ToastTone, ms: number | null): void {
  current = { text, tone };
  clearTimeout(timer);
  timer = ms == null ? undefined : setTimeout(() => (current = null), ms);
}

export const toast = {
  /** The visible message, or null. Read-only for components; write through the helpers. */
  get current(): Toast | null {
    return current;
  },
  /** A confirmation. Dismisses itself in {@link OK_MS}. */
  ok(text: string): void {
    show(text, 'ok', OK_MS);
  },
  /** A failure. Dismissable by hand or in {@link ERROR_MS} — never silently. */
  error(text: string): void {
    show(text, 'error', ERROR_MS);
  },
  /**
   * Work in progress. Sticky by design: a spinner that vanishes on its own mid-task
   * tells the rider the task ended, and it has not.
   */
  busy(text: string): void {
    show(text, 'busy', null);
  },
  /** Drop the current message now. */
  clear(): void {
    clearTimeout(timer);
    current = null;
  }
};
