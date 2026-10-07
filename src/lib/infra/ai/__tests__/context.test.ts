import { describe, expect, it } from 'vitest';
import { buildCoachContext, buildWeekContext, renderContext, weekWindow } from '../context';

/**
 * The context builder is the last line of defence before a model. Its contract is
 * narrow and absolute: every number in it traces to a stored row or a tested domain
 * function, and anything unknown is `null` rather than a plausible default. These tests
 * assert that contract, not the arithmetic — the arithmetic belongs to `domain/`.
 */

/**
 * A Wednesday, so the Monday-based window has days on both sides of it.
 * Built from local components (and stored as local-naive strings below) so the window
 * contract is pinned in the runner's own zone rather than in Bangkok's or UTC's.
 */
const WED = new Date(2026, 9, 7, 14, 30);

const THIS_WEEK = [
  { date: '2026-10-05T06:00:00', distanceKm: 100, elevGainM: 1500, movingSec: 4 * 3600, tss: 200, np: 210 },
  { date: '2026-10-07T06:00:00', distanceKm: 50, elevGainM: 300, movingSec: 2 * 3600, tss: 90, np: 190 }
];
const LAST_WEEK = { date: '2026-09-28T06:00:00', distanceKm: 200, elevGainM: 3000, movingSec: 8 * 3600, tss: 400, np: 220 };

describe('weekWindow', () => {
  it('starts on the Monday of the current week', () => {
    const w = weekWindow(WED);
    // Wed 7 Oct 2026 sits in the week beginning Mon 5 Oct
    expect(w.from).toBe('2026-10-05');
    expect(w.to).toBe('2026-10-07');
    expect(new Date(`${w.from}T00:00:00`).getDay()).toBe(1);
  });

  it('treats Sunday as the last day of its week, not the first', () => {
    // local Sun 11 Oct, late evening — the classic off-by-one
    const w = weekWindow(new Date(2026, 9, 11, 23, 0));
    expect(w.from).toBe('2026-10-05');
    expect(w.to).toBe('2026-10-11');
  });

  it('buckets by the rider’s local day, matching how ride rows are stored', () => {
    // Ride rows are local-naive wall-clock (the Strava mapper writes them that way), so
    // the window must be computed in the same local frame: early-morning local Monday is
    // still Sunday in UTC, and a UTC-frame window would slip back to the previous Monday
    // (2026-09-28). The local frame keeps both ends on Monday 05 Oct itself.
    const w = weekWindow(new Date(2026, 9, 5, 3, 0)); // local Mon 05 Oct, early hours
    expect(w.to).toBe('2026-10-05');
    expect(w.from).toBe('2026-10-05');
  });

  it('starts the week on Monday itself, not the previous Monday', () => {
    expect(weekWindow(new Date(2026, 9, 5, 8, 0)).from).toBe('2026-10-05');
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
      [...THIS_WEEK, { date: '2026-10-06T06:00:00', distanceKm: 10, elevGainM: 0, movingSec: 1800 }],
      WED
    );
    expect(week.rides).toBe(3);
    expect(week.withPower).toBe(2);
  });

  it('flags demo data so a review of seeded rides can say so', () => {
    const week = buildWeekContext([...THIS_WEEK, { ...LAST_WEEK, synthetic: true, date: '2026-10-06T06:00:00' }], WED);
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
    const week = buildWeekContext([{ date: '2026-10-06T06:00:00', distanceKm: NaN, elevGainM: NaN, movingSec: NaN }], WED);
    expect(week.distanceKm).toBe(0);
    expect(week.rides).toBe(1);
  });

  it('excludes non-cycling sport types a Strava sync pulls', () => {
    const week = buildWeekContext(
      [
        ...THIS_WEEK,
        { date: '2026-10-06T06:00:00', distanceKm: 4, elevGainM: 0, movingSec: 3300, sportType: 'Walk' },
        { date: '2026-10-06T07:00:00', distanceKm: 30, elevGainM: 100, movingSec: 3600, sportType: 'VirtualRide' }
      ],
      WED
    );
    // the walk is real activity but not riding — it must not inflate rides or kilometres;
    // the virtual ride does count
    expect(week.rides).toBe(3);
    expect(week.distanceKm).toBe(180);
  });

  it('counts rows without a sport type as rides — imports and legacy rows are rides', () => {
    const week = buildWeekContext([{ date: '2026-10-06T06:00:00', distanceKm: 20, elevGainM: 0, movingSec: 1800 }], WED);
    expect(week.rides).toBe(1);
    expect(week.distanceKm).toBe(20);
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
