import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The install store is the only thing standing between a rider and a button that pops
 * nothing. These tests pin the properties both surfaces (banner + Settings) depend on:
 *
 *  1. **no dead button** — the Install affordance exists exactly while a captured
 *     `beforeinstallprompt` lives, and Settings falls back to instructions otherwise;
 *  2. **one prompt, ever** — Chromium accepts one `prompt()` per event, so the event is
 *     consumed the moment it fires; a second call must answer 'unavailable', not pop
 *     the native dialog again;
 *  3. **dismissal is a decision** — "Not now" silences the banner across sessions but
 *     deliberately leaves the Settings row armed (the deliberate second door);
 *  4. **pacing** — a live prompt alone never shows the banner; the rider's first
 *     gesture of the session does. Tests that assert a *false* still interact first,
 *     so the false can only be the reason under test.
 *
 * The store keeps module-level runes state, so each test takes a fresh instance via
 * `vi.resetModules()` — the alternative (one shared instance with hand-restored
 * globals) is exactly the coupling that makes store tests rot.
 */
type Store = typeof import('../pwa-install.svelte');
type PromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISSED_KEY = 'zonadua.install.dismissed';

/** A fresh store instance: resets module state, then imports it again. */
async function freshStore(): Promise<Store> {
  vi.resetModules();
  return await import('../pwa-install.svelte');
}

/** A synthetic `beforeinstallprompt`, since happy-dom never fires one on its own. */
function fakePrompt(calls: { prompted: number }, outcome: 'accepted' | 'dismissed' = 'accepted'): PromptEvent {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as PromptEvent;
  e.prompt = () => {
    calls.prompted += 1;
    return Promise.resolve();
  };
  e.userChoice = Promise.resolve({ outcome });
  return e;
}

/**
 * The rider's first gesture, as the store's pacing gate reads it. Called explicitly by
 * every test that asserts *about* the banner rather than about its absence — otherwise
 * `canInstall === false` would also hold without any dismissal and prove nothing.
 */
function interact(): void {
  window.dispatchEvent(new Event('pointerdown'));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('arming — a live prompt is the only source of an install affordance', () => {
  it('starts disarmed, so a browser that never offers a prompt shows no button to press', async () => {
    const s = await freshStore();
    s.initPwaInstall();
    expect(s.pwaInstall.canInstall).toBe(false); // the banner stays off
    expect(s.pwaInstall.canPrompt).toBe(false); // Settings renders instructions, not a button
  });

  it('arms both surfaces when the browser fires, and suppresses its own infobar', async () => {
    const s = await freshStore();
    s.initPwaInstall();
    const e = fakePrompt({ prompted: 0 });
    window.dispatchEvent(e);
    // preventDefault is what keeps Chromium from stacking its mini-infobar on our card
    expect(e.defaultPrevented).toBe(true);
    expect(s.pwaInstall.canPrompt).toBe(true); // the inline Settings row arms immediately
    expect(s.pwaInstall.canInstall).toBe(false); // the banner waits for the first gesture

    interact();
    expect(s.pwaInstall.canInstall).toBe(true);
  });

  it('stays disarmed when the app already runs standalone', async () => {
    // an installed app asking to be installed is nonsense the store must filter out
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const s = await freshStore();
    s.initPwaInstall();
    window.dispatchEvent(fakePrompt({ prompted: 0 }));
    interact(); // remove pacing from the equation — standalone alone must hold it off
    expect(s.pwaInstall.isStandalone).toBe(true);
    expect(s.pwaInstall.canInstall).toBe(false);
    expect(s.pwaInstall.canPrompt).toBe(false);
  });
});

describe('pacing — the banner never ambushes an untouched screen', () => {
  it('stays hidden after a live prompt until the rider interacts once', async () => {
    const s = await freshStore();
    s.initPwaInstall();
    window.dispatchEvent(fakePrompt({ prompted: 0 }));

    expect(s.pwaInstall.canInstall).toBe(false); // prompt is live, but nobody has touched the app
    expect(s.pwaInstall.canPrompt).toBe(true); // an inline row behind navigation is not an ambush

    interact();
    expect(s.pwaInstall.canInstall).toBe(true);
  });

  it('counts a tap, a key or a scroll as that first interaction', async () => {
    for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
      const s = await freshStore();
      s.initPwaInstall();
      window.dispatchEvent(fakePrompt({ prompted: 0 }));
      expect(s.pwaInstall.canInstall).toBe(false);

      window.dispatchEvent(new Event(type));
      expect(s.pwaInstall.canInstall).toBe(true);
    }
  });
});

describe('promptInstall — one prompt, ever', () => {
  it('fires the native prompt exactly once and reports acceptance', async () => {
    const s = await freshStore();
    s.initPwaInstall();
    const calls = { prompted: 0 };
    window.dispatchEvent(fakePrompt(calls));

    await expect(s.pwaInstall.promptInstall()).resolves.toBe('accepted');
    expect(calls.prompted).toBe(1);
    expect(s.pwaInstall.isStandalone).toBe(true); // instant UI flip, no reload needed

    // the event was consumed: a second press answers honestly instead of re-prompting
    await expect(s.pwaInstall.promptInstall()).resolves.toBe('unavailable');
    expect(calls.prompted).toBe(1);
  });

  it('answers unavailable with nothing captured — the caller falls back to instructions', async () => {
    const s = await freshStore();
    s.initPwaInstall();
    await expect(s.pwaInstall.promptInstall()).resolves.toBe('unavailable');
  });

  it('remembers when the rider dismissed the native dialog, like "Not now"', async () => {
    const s = await freshStore();
    s.initPwaInstall();
    window.dispatchEvent(fakePrompt({ prompted: 0 }, 'dismissed'));
    interact(); // so a false below can only mean "dismissed", not "never interacted"

    await expect(s.pwaInstall.promptInstall()).resolves.toBe('dismissed');
    expect(s.pwaInstall.dismissed).toBe(true);
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('1');
    expect(s.pwaInstall.canInstall).toBe(false); // the banner stops asking
    // unlike the banner's "Not now", a native dismissal consumed the event — there is
    // no prompt left to fire, so Settings falls to its instructions branch rather than
    // offering a button that would pop nothing
    expect(s.pwaInstall.canPrompt).toBe(false);
  });
});

describe('dismissal — remembered, reversible, never a trap', () => {
  it('"Not now" silences the banner for good while Settings stays armed', async () => {
    const s = await freshStore();
    s.initPwaInstall();
    window.dispatchEvent(fakePrompt({ prompted: 0 }));
    interact();
    expect(s.pwaInstall.canInstall).toBe(true); // armed — so the false below is dismissal's doing

    s.pwaInstall.dismiss();
    expect(s.pwaInstall.canInstall).toBe(false);
    expect(s.pwaInstall.canPrompt).toBe(true); // the deliberate second door
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('1');
  });

  it('a device that dismissed stays quiet even when the browser fires again', async () => {
    // the flag is read at module load, exactly as a returning session reads it
    localStorage.setItem(DISMISSED_KEY, '1');
    const s = await freshStore();
    s.initPwaInstall();
    window.dispatchEvent(fakePrompt({ prompted: 0 }));
    interact(); // pacing satisfied — the flag alone must hold the banner off

    expect(s.pwaInstall.canInstall).toBe(false); // no banner, this session or the next
    expect(s.pwaInstall.canPrompt).toBe(true); // rider can still reverse the decision
  });
});

describe('appinstalled — the surfaces follow reality', () => {
  it('flips to standalone and disarms everything the moment the browser confirms', async () => {
    const s = await freshStore();
    s.initPwaInstall();
    window.dispatchEvent(fakePrompt({ prompted: 0 }));
    interact();
    expect(s.pwaInstall.canInstall).toBe(true);

    window.dispatchEvent(new Event('appinstalled'));
    expect(s.pwaInstall.isStandalone).toBe(true);
    expect(s.pwaInstall.canInstall).toBe(false); // banner gone
    expect(s.pwaInstall.canPrompt).toBe(false); // Settings shows "Running as the installed app"
  });
});
