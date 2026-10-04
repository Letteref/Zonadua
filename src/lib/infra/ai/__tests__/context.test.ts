import { describe, expect, it } from 'vitest';
import { buildCoachContext, buildWeekContext, renderContext, weekWindow } from '../context';

/**
 * The context builder is the last line of defence before a model. Its contract is
 * narrow and absolute: every number in it traces to a stored row or a tested domain
 * function, and anything unknown is `null` rather than a plausible default. These tests
 * assert that contract, not the arithmetic — the arithmetic belongs to `domain/`.
 */

/** A Wednesday, so the Monday-based window has days on both sides of it. */
const WED = new Date('2026-10-07T14:30:00.000Z');

const THIS_WEEK = [
  { date: '2026-10-05T06:00:00.000Z', distanceKm: 100, elevGainM: 1500, movingSec: 4 * 3600, tss: 200, np: 210 },
  { date: '2026-10-07T06:00:00.000Z', distanceKm: 50, elevGainM: 300, movingSec: 2 * 3600, tss: 90, np: 190 }
];
const LAST_WEEK = { date: '2026-09-28T06:00:00.000Z', distanceKm: 200, elevGainM: 3000, movingSec: 8 * 3600, tss: 400, np: 220 };

describe('weekWindow', () => {
  it('starts on the Monday of the current week', () => {
    const w = weekWindow(WED);
    // Wed 7 Oct 2026 sits in the week beginning Mon 5 Oct
    expect(w.from).toBe('2026-10-05');
    expect(w.to).toBe('2026-10-07');
    expect(new Date(`${w.from}T00:00:00`).getDay()).toBe(1);
  });

  it('treats Sunday as the last day of its week, not the first', () => {
    // Sun 11 Oct belongs to the week starting Mon 5 Oct — the classic off-by-one
    const w = weekWindow(new Date('2026-10-11T23:00:00.000Z'));
    expect(w.from).toBe('2026-10-05');
    expect(w.to).toBe('2026-10-11');
  });

  it('buckets by UTC day, like every other date key in the data layer', () => {
    // ride dates are stored in UTC, so a window computed in local time would compare a
    // local midnight against UTC dates and shift a ride into the neighbouring week for
    // anyone not on UTC. This date is 5 Oct in Bangkok but already 4 Oct in UTC.
    expect(weekWindow(new Date('2026-10-04T20:00:00.000Z')).to).toBe('2026-10-04');
    expect(weekWindow(new Date('2026-10-04T20:00:00.000Z')).from).toBe('2026-09-28');
  });

  it('starts the week on Monday itself, not the previous Monday', () => {
    expect(weekWindow(new Date('2026-10-05T08:00:00.000Z')).from).toBe('2026-10-05');
  });
});

describe('buildWeekContext', () => {
  it('counts only the rides inside the window', () => {
    const week = buildWeekContext([...THIS_WEEK, LAST_WEEK], WED);
    // last week's 200 km must not leak into this week's totals
    expect(week.rides).toBe(2);
    expect(week.distanceKm).toBe(150);
    expect(week.elevGainM).toBe(1800);
    expect(week.movingSec).toBe(6 * 3600);
    expect(week.tss).toBe(290);
  });

  it('reports rides carrying power separately from rides without', () => {
    const week = buildWeekContext(
      [...THIS_WEEK, { date: '2026-10-06T06:00:00.000Z', distanceKm: 10, elevGainM: 0, movingSec: 1800 }],
      WED
    );
    expect(week.rides).toBe(3);
    expect(week.withPower).toBe(2);
  });

  it('flags demo data so a review of seeded rides can say so', () => {
    const week = buildWeekContext([...THIS_WEEK, { ...LAST_WEEK, synthetic: true, date: '2026-10-06T06:00:00.000Z' }], WED);
    expect(week.includesDemo).toBe(true);
  });

  it('does not flag demo data when the window holds none', () => {
    expect(buildWeekContext(THIS_WEEK, WED).includesDemo).toBe(false);
  });

  it('returns an empty week rather than throwing on no rides', () => {
    const week = buildWeekContext([], WED);
    expect(week.rides).toBe(0);
    expect(week.distanceKm).toBe(0);
    // zero with a real meaning ("nothing ridden") is different from unknown, and the
    // builder must be able to say the former
    expect(week.tss).toBe(0);
  });

  it('does not invent a distance for a ride that has none', () => {
    const week = buildWeekContext([{ date: '2026-10-06T06:00:00.000Z', distanceKm: NaN, elevGainM: NaN, movingSec: NaN }], WED);
    expect(week.distanceKm).toBe(0);
    expect(week.rides).toBe(1);
  });
});

describe('buildCoachContext', () => {
  const athlete = { weightKg: 68.2, ftp: 275, heightCm: 174 };

  it('returns null when there is nothing to review', () => {
    // an empty history is not a thin history; prompting a review of zero rides would be
    // asking a model to comment on the absence of training
    expect(buildCoachContext({ rides: [], athlete, now: WED })).toBeNull();
  });

  it('returns a context when rides exist even with no load history', () => {
    const ctx = buildCoachContext({ rides: THIS_WEEK, athlete, now: WED })!;
    expect(ctx.week.rides).toBe(2);
    expect(ctx.load.loaded).toBe(false);
  });

  it('returns a context from load history alone, even with no rides this week', () => {
    const ctx = buildCoachContext({
      rides: [],
      athlete,
      load: { ctl: 62, atl: 55, tsb: 7, form: 'productive' },
      now: WED
    })!;
    expect(ctx.week.rides).toBe(0);
    expect(ctx.load.ctl).toBe(62);
    expect(ctx.load.loaded).toBe(true);
  });

  it('keeps an unweighed rider unknown rather than averaging one in', () => {
    const ctx = buildCoachContext({ rides: THIS_WEEK, athlete: { ftp: 275 }, now: WED })!;
    // a plan built on an invented 70 kg for someone who weighs 54 kg looks personal
    expect(ctx.athlete.weightKg).toBeNull();
    expect(ctx.athlete.ftp).toBe(275);
  });

  it('treats a missing FTP and missing height as null', () => {
    const ctx = buildCoachContext({ rides: THIS_WEEK, athlete: {}, now: WED })!;
    expect(ctx.athlete.ftp).toBeNull();
    expect(ctx.athlete.heightCm).toBeNull();
  });

  it('leaves load null when the caller has no load series', () => {
    const ctx = buildCoachContext({ rides: THIS_WEEK, athlete, now: WED })!;
    expect(ctx.load.ctl).toBeNull();
    expect(ctx.load.form).toBeNull();
  });
});

describe('renderContext', () => {
  const ctx = buildCoachContext({
    rides: THIS_WEEK,
    athlete: { ftp: 275 },
    load: { ctl: 62, atl: 55, tsb: 7, form: 'productive' },
    now: WED
  })!;

  it('prints every figure the context actually holds', () => {
    const text = renderContext(ctx);
    expect(text).toContain('rides: 2');
    expect(text).toContain('distance_km: 150');
    expect(text).toContain('ftp_w: 275');
    expect(text).toContain('ctl: 62');
  });

  it('writes "not measured" rather than a number for anything unknown', () => {
    const text = renderContext(ctx);
    expect(text).toContain('weight_kg: not measured');
    expect(text).toContain('height_cm: not measured');
    // a zero here would be the model filling in a plausible figure for a missing one
    expect(text).not.toMatch(/weight_kg: 0/);
  });

  it('surfaces the demo flag so the prompt can refuse to review seeded rides', () => {
    const withDemo = buildCoachContext({
      rides: [{ ...THIS_WEEK[0], synthetic: true }],
      athlete: { ftp: 275 },
      now: WED
    })!;
    expect(renderContext(withDemo)).toContain('includes_demo_data: true');
  });

  it('converts moving seconds to whole minutes', () => {
    expect(renderContext(ctx)).toContain('moving_time_min: 360');
  });
});
