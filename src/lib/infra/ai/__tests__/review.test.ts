import { describe, it, expect } from 'vitest';
import { buildCoachContext } from '../context';
import { buildWeeklyReview, verifyReview } from '../review';

/**
 * The gate that blocks a hallucinated coach answer has to be checked against the
 * *prompt*, not against a re-serialisation of the context object.
 *
 * `renderContext` deliberately prints figures the raw object never holds — moving time
 * in minutes where the field is seconds, `not measured` where the field is `null`. A
 * model that reads "moving_time_min: 76" out of the prompt and says "76 minutes" is
 * being perfectly honest, and a verifier handed the JSON rejects it, because 76 appears
 * nowhere in a record that only ever said 4560.
 *
 * That is the worst possible failure for this gate: it shows "The coach invented
 * numbers" on correct answers, and once that message is noise the gate stops being read
 * at all — which is the exact condition under which a real hallucination sails through.
 *
 * These tests go through `buildWeeklyReview`/`verifyReview` rather than calling
 * `verifyNumbers` directly, because the bug lived in *which document got passed*, not in
 * the comparison itself. Testing the helper directly would have stayed green while the
 * route was broken.
 */
describe('weekly review verification', () => {
  const ctx = buildCoachContext({
    rides: [
      { date: '2026-10-01T09:00:00Z', distanceKm: 40.2, elevGainM: 600, movingSec: 4560, tss: 88, np: 210 }
    ],
    athlete: { weightKg: 68, ftp: 265, heightCm: 178 },
    now: new Date('2026-10-04T12:00:00Z')
  })!;

  const request = buildWeeklyReview(ctx);

  it('the prompt carries a figure the raw context object does not', () => {
    // 76 exists only because renderContext divided 4560 seconds into minutes
    expect(request.prompt).toContain('76');
    expect(JSON.stringify(ctx)).toContain('4560');
    expect(JSON.stringify(ctx)).not.toMatch(/"76"/);
  });

  it('accepts an honest answer that restates a figure from the prompt', () => {
    const honest = 'You covered 40.2 km this week in 76 minutes for 88 TSS.';

    const result = verifyReview(request, honest);

    expect(result.ungrounded).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.text).toBe(honest);
  });

  it('still rejects a number found in neither the prompt nor the object', () => {
    const invented = 'You covered 40.2 km this week in 76 minutes for 88 TSS and burned 315 W.';

    const result = verifyReview(request, invented);

    expect(result.ok).toBe(false);
    expect(result.ungrounded).toContain(315);
    // a blocked answer must render as nothing, not as a warning
    expect(result.text).toBeNull();
  });

  it('rejects an answer built from the object instead of the prompt', () => {
    // the specific regression: 4560 is a real field value, so a JSON-flavoured answer
    // would pass a naive check while containing a number the rider never saw stated
    const secondsSpoken = 'You spent 4560 seconds moving this week.';

    expect(verifyReview(request, secondsSpoken).ok).toBe(false);
  });

  it('a system prompt exists and is not empty', () => {
    expect(request.system.length).toBeGreaterThan(0);
    expect(request.system).toMatch(/not enough data|never estimate/i);
  });
});