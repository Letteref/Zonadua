/**
 * The app-install flow — one store, two doors.
 *
 * ## Why this file exists
 *
 * The PWA is installable (manifest + service worker are in every production build), but
 * nothing ever *told* the rider that. The only signal a browser gives us is the
 * `beforeinstallprompt` event, which fires once, carries the one and only `prompt()`
 * call Chromium will accept, and disappears if nobody listens. Two surfaces need it —
 * a floating banner and a Settings row — so it belongs in one store, not two listeners
 * racing for the same one-shot event.
 *
 * ## The contract
 *
 * - **Never a dead button.** When no prompt is available (iOS Safari, desktop Firefox,
 *   the rider already dismissed, the browser already installed us), the surfaces show
 *   honest fallback copy — never a button that does nothing when pressed. The store
 *   exposes `canInstall` precisely so a component cannot guess.
 * - **Dismissal is a decision, remembered.** "Not now" writes a localStorage flag and
 *   the banner stays gone across sessions; the Settings row remains as the deliberate
 *   second door, so a change of heart needs no digging. Reset-on-wipe lives with the
 *   other localStorage flags in `onboarding.svelte.ts`'s territory — the flag is a
 *   preference, not progress.
 * - **One prompt, ever.** Chrome allows a single `prompt()` per captured event and
 *   answers `userChoice`; the store consumes the event the moment it fires it, so the
 *   banner and Settings can never both pop the native dialog.
 * - **The pop-up waits its turn.** The banner additionally requires the rider's first
 *   real gesture of the session (`pointerdown`, `keydown` or `wheel`) — a page that
 *   just finished loading has no business pitching anything. The Settings row needs
 *   no such gate: navigating to Settings *is* the interaction.
 *
 * Pure browser state: no Dexie, no fetch. `initPwaInstall()` is called once from
 * `App.svelte`'s boot; every read goes through the exported singleton.
 */

type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

/** The browser's install event: standard Event plus the two members we actually use. */
type BeforeInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISSED_KEY = 'zonadua.install.dismissed';

let deferred = $state<BeforeInstallPrompt | null>(null);
let standalone = $state(false);
let dismissed = $state(readDismissed());
/** The rider has touched the app at least once this session — the banner's pacing gate. */
let interacted = $state(false);
let inited = false;

function readDismissed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(DISMISSED_KEY) === '1';
}

/**
 * Standalone means "already installed": Chromium reports it as display-mode, iOS Safari
 * as `navigator.standalone`. Both are read at init and re-read on the media-query change
 * so installing in another tab flips this app's surfaces without a reload.
 */
function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mq = window.matchMedia?.('(display-mode: standalone)');
  if (mq?.matches) return true;
  return (window.navigator as { standalone?: boolean }).standalone === true;
}

/**
 * Attach the one-shot listeners. Idempotent, and safe to call before first paint: the
 * event itself arrives asynchronously after load, so `onMount` is early enough. Calling
 * `preventDefault()` suppresses Chromium's own mini-infobar — this app's surfaces are
 * the designed prompt, and two competing prompts is slop.
 */
export function initPwaInstall(): void {
  if (inited || typeof window === 'undefined') return;
  inited = true;
  standalone = detectStandalone();

  // Pacing: the banner may not be the first thing a rider meets. Registered here rather
  // than at module load so tests control when listeners attach; if a gesture somehow
  // lands before boot finishes, the next one counts — a rider who has touched nothing
  // yet is not the one we are waiting for anyway.
  const markInteracted = (): void => {
    interacted = true;
  };
  for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
    window.addEventListener(type, markInteracted, { once: true, passive: true });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPrompt;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    standalone = true;
  });
}

export const pwaInstall = {
  /**
   * The *banner's* condition: a live prompt, not installed, not told "Not now", and the
   * rider has interacted at least once this session. Keeping the dismissal out of
   * {@link canPrompt} is deliberate — Settings stays the way back for a rider who
   * changed their mind; the interaction gate also applies only here, for the same
   * reason: a pop-up on arrival is a pitch, an inline row behind navigation is not.
   */
  get canInstall(): boolean {
    return deferred !== null && !standalone && !dismissed && interacted;
  },
  /**
   * The *Settings* condition: a live prompt and not installed, dismissal ignored — the
   * row is the deliberate second door, so hiding it after "Not now" would trap the
   * rider out of a decision they are allowed to reverse.
   */
  get canPrompt(): boolean {
    return deferred !== null && !standalone;
  },
  /** Already running as an installed app — the Settings row says so instead of offering. */
  get isStandalone(): boolean {
    return standalone;
  },
  /** The rider said "Not now" — the banner stays quiet; Settings remains reachable. */
  get dismissed(): boolean {
    return dismissed;
  },

  /**
   * Fire the native prompt. The captured event is consumed first (Chrome accepts one
   * prompt per event — holding it across a rejection just yields a dead button), and
   * the outcome is the caller's to report:
   * - accepted  → `appinstalled` will also land, but standalone flips now for instant UI
   * - dismissed → the browser said no; remember it so the banner stops asking
   * - unavailable → nothing was captured; the caller falls back to instructions
   */
  async promptInstall(): Promise<InstallOutcome> {
    const evt = deferred;
    deferred = null;
    if (!evt || standalone) return 'unavailable';
    try {
      await evt.prompt();
      const choice = await evt.userChoice;
      if (choice.outcome === 'accepted') {
        standalone = true;
        return 'accepted';
      }
      dismissed = true;
      if (typeof localStorage !== 'undefined') localStorage.setItem(DISMISSED_KEY, '1');
      return 'dismissed';
    } catch {
      // a prompt thrown after the gesture expired is indistinguishable, from the
      // rider's chair, from a browser that never offered one
      return 'unavailable';
    }
  },

  /** "Not now": hide the banner for good. The Settings row is the way back. */
  dismiss(): void {
    dismissed = true;
    if (typeof localStorage !== 'undefined') localStorage.setItem(DISMISSED_KEY, '1');
  }
};
