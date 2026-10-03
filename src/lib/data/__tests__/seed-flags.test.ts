import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSeedingSuppressed, markWiped } from '../seed';

/**
 * The device half of "Delete all data" (UI-SPEC §30), re-tested after the rename (§36).
 *
 * The failure this guards is not hypothetical. Renaming the app meant renaming these two
 * localStorage keys from `gowslab.*` to `zonadua.*`, and a plain find-and-replace would have
 * deleted the mark for every rider who had already pressed the button. That mark is the only
 * thing standing between a deliberately emptied database and the seeder, which sees empty
 * tables as a first launch and hands back 24 demo rides seconds after promising they cannot
 * be undone.
 *
 * So the rename is only safe because the old keys are still *read*. These tests fail the
 * moment someone tidies them away.
 */
describe('seed suppression survives the app rename', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('is not suppressed on a device that never wiped anything', () => {
    expect(isSeedingSuppressed()).toBe(false);
  });

  it('suppresses the seed after this build marks the wipe', () => {
    markWiped();
    expect(isSeedingSuppressed()).toBe(true);
  });

  it('still honours a wipe recorded under the pre-rename key', () => {
    localStorage.setItem('gowslab.wiped', '1');
    expect(isSeedingSuppressed()).toBe(true);
  });

  it('leaves a device that only carries the old seed marker alone', () => {
    // `seeded` and `wiped` answer different questions. Only the wipe suppresses anything, so
    // the legacy seed key must not be mistaken for consent to re-seed over an empty database.
    localStorage.setItem('gowslab.seeded', '1');
    expect(isSeedingSuppressed()).toBe(false);
  });

  it('writes the current key, not the legacy one', () => {
    markWiped();
    expect(localStorage.getItem('zonadua.wiped')).toBe('1');
  });
});
