import { describe, it, expect } from 'vitest';
import { shouldSynthesiseTrace } from '../recompute';

/**
 * Why these are unit tests on a predicate rather than an IndexedDB integration test
 *
 * The backfill's decision is a pure function of three row properties, and the question
 * worth asking is narrow: *which rows are allowed to receive a fabricated power trace*.
 * Driving it through Dexie would need `fake-indexeddb`, a new dev dependency, to exercise
 * a boolean. The predicate is exported precisely so this can be tested without one.
 *
 * The claim under test is `recompute.ts`'s own header comment:
 *
 *   "Only rows the seeder produced can be in this state (the GPX/TCX importer never
 *    writes `np`), so this upgrades old fabricated demo data instead of faking numbers
 *    onto genuine rider data."
 *
 * That is a statement about the *importer*. The predicate is a statement about every row
 * in the table, including rows that arrived by restore. Those are different populations,
 * and only one of them is covered by the argument.
 */
describe('which rows may be given a synthetic power trace', () => {
  const demo = { synthetic: true, np: 240 };
  const realWithPower = { synthetic: false, np: 240 };
  const realWithoutPower = { synthetic: false, np: null };
  const realWithoutFlag = { synthetic: undefined, np: 240 };
  const staleGenerator = { synthetic: true, np: 240, synthVersion: 0 };

  it('generates for demo rows, which is the case the comment describes', () => {
    expect(shouldSynthesiseTrace(demo, false)).toBe(true);
  });

  it('regenerates when the generator version moved on', () => {
    expect(shouldSynthesiseTrace(staleGenerator, false)).toBe(true);
  });

  it('does not touch a ride with no power at all', () => {
    expect(shouldSynthesiseTrace(realWithoutPower, false)).toBe(false);
  });

  it('does not touch a row that already has a real power trace', () => {
    // hasTrace = true is what makes this safe: the row is being upgraded, not invented
    expect(shouldSynthesiseTrace(realWithPower, true)).toBe(false);
  });

  /**
   * The regression this suite exists for.
   *
   * A row with real provenance carrying `np` but no stream is exactly what a legacy
   * backup restores to: the restore path merges whatever tables the file contains, and it
   * explicitly accepts `gowslab` payloads written before `activity_streams` existed. The
   * importer argument that justified the old rule does not cover that population.
   *
   * It used to return `true` here, which attached a generated trace to the rider's own
   * ride, recomputed its metrics from that trace, and left the badge reading Strava.
   */
  it('never fabricates a trace for a real ride that carries np but no stream', () => {
    expect(shouldSynthesiseTrace(realWithPower, false)).toBe(false);
    expect(shouldSynthesiseTrace(realWithoutFlag, false)).toBe(false);
  });
});