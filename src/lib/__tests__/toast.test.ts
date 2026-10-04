import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '../toast.svelte';

/**
 * The toast store is the only thing standing between a failed Dexie write and a rider
 * who believes it succeeded. These tests pin the two properties that matter:
 *
 *  1. a failure is never dressed as a confirmation, and
 *  2. nothing is stuck on screen forever unless it is work in progress.
 *
 * The durations themselves are part of the contract — they are the three numbers that
 * drifted apart when each route had its own copy (Rides 3400, Routes 3400 + sticky,
 * Settings 3000). Asserting them is what stops a fourth route from inventing a fifth.
 */
describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toast.clear();
  });

  afterEach(() => {
    toast.clear();
    vi.useRealTimers();
  });

  it('starts empty and shows the tone it was given', () => {
    expect(toast.current).toBeNull();
    toast.ok('Zones saved');
    expect(toast.current).toEqual({ text: 'Zones saved', tone: 'ok' });
  });

  it('dismisses a confirmation after 3.4 s', () => {
    toast.ok('Zones saved');
    vi.advanceTimersByTime(3399);
    expect(toast.current).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(toast.current).toBeNull();
  });

  it('keeps a failure up about twice as long, because it has to be read', () => {
    toast.error('Could not save profile');
    vi.advanceTimersByTime(3400);
    // a failure must outlive the confirmation window, or the rider glances and misses it
    expect(toast.current).toEqual({ text: 'Could not save profile', tone: 'error' });
    vi.advanceTimersByTime(2600);
    expect(toast.current).toBeNull();
  });

  it('never lets a failed write report itself as a success', () => {
    // the exact regression that motivated the shared store: "Backup failed" used to
    // render with the same green check glyph as "Zones saved"
    toast.error('Backup failed');
    expect(toast.current?.tone).not.toBe('ok');
  });

  it('keeps a busy message on screen until something replaces it', () => {
    toast.busy('Parsing route…');
    vi.advanceTimersByTime(60_000);
    expect(toast.current).toEqual({ text: 'Parsing route…', tone: 'busy' });
    toast.error('Import failed — use a GPX file with trackpoints');
    expect(toast.current?.tone).toBe('error');
  });

  it('restarts the clock when a second message replaces the first', () => {
    toast.ok('Profile saved');
    vi.advanceTimersByTime(3000);
    toast.ok('Zones saved');
    // the first message's timer must not take the second one down with it
    vi.advanceTimersByTime(500);
    expect(toast.current).toEqual({ text: 'Zones saved', tone: 'ok' });
  });

  it('can be dismissed by hand, which is the only way to clear a sticky failure early', () => {
    toast.error('Could not finish the race — try again');
    toast.clear();
    expect(toast.current).toBeNull();
    // and clearing must not leave a timer that fires against a later message
    toast.ok('Race finished');
    vi.advanceTimersByTime(1000);
    expect(toast.current).toEqual({ text: 'Race finished', tone: 'ok' });
  });
});
