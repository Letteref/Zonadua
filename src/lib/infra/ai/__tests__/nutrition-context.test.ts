import { describe, it, expect } from 'vitest';
import { buildNutritionContext, buildCoachContext, renderContext } from '../context';
import { planNutrition } from '../../../domain/nutrition';

/**
 * Race fueling is the number a model is most likely to answer from population averages,
 * and the number a rider acts on at 5am. So the rule under test is narrow and absolute:
 * every gram and litre in the prompt comes out of `planNutrition`, or the block says why
 * it could not be computed and carries `null` rather than a zero.
 *
 * A `0` would be the quiet failure here — "carb_g_per_h: 0" reads as an instruction to
 * ride without fuel, which is both a number nobody measured and bad advice.
 */
describe('race fueling context', () => {
  const solved = {
    ok: true,
    energyKJ: 9_000,
    movingSec: 5_400, // 1.5 h
    stopSec: 900
  };
  const stops = { count: 3, minutesEach: 15 };
  const race = { raceName: 'Gran Fondo', distanceKm: 160 };

  /**
   * The clock these context tests run against — fixed, like `context.test.ts`'s `WED`, so
   * the suite does not depend on when or where it runs.
   *
   * Chosen to be Monday 03:00 local, the exact hour this file used to fail. The ride
   * timestamp was built with `new Date().toISOString()`, which stamps the **UTC** calendar
   * day, while `weekWindow` builds its Monday-to-today window from **local** days. Between
   * 00:00 and 07:00 in UTC+7 the two disagree by a day — at this clock `toISOString()`
   * reads `2026-10-25T20:00Z`, a day before the window opens — so the week's only ride was
   * filtered out, `buildCoachContext` returned `null`, and these tests died on an empty
   * render instead of on the fueling figures they are actually about.
   */
  const now = new Date(2026, 9, 26, 3, 0);

  /**
   * The week's one ride, stamped from that same clock in the local-naive shape rides are
   * stored in (`2026-10-26T02:00:00`, no zone suffix). Deriving it from `now` rather than
   * writing the day out again keeps the two halves from drifting apart, and putting
   * `now.toISOString()` here would be the same bug wearing a different hat: a UTC day is
   * a different string from a local day, and `weekWindow` compares them as text.
   */
  const pad = (n: number) => String(n).padStart(2, '0');
  const rideRow = {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T02:00:00`,
    distanceKm: 40,
    elevGainM: 100,
    movingSec: 3600,
    tss: 50
  };

  it('quotes exactly what planNutrition computed', () => {
    const block = buildNutritionContext({ ...race, plan: solved, stops, riderKg: 68 });
    const expected = planNutrition({
      riderKg: 68,
      energyKJ: 9_000,
      movingSec: 5_400,
      stopCount: 3,
      stopMinutes: 15
    })!;

    expect(block).not.toBeNull();
    expect(block!.carbPerHour).toBe(expected.carbPerHour);
    expect(block!.fluidPerHour).toBe(expected.fluidPerHour);
    expect(block!.mixPerStopG).toBe(expected.mixPerStopG);
    expect(block!.reason).toBeNull();
  });

  it('reports an unknown body weight instead of inventing one', () => {
    const block = buildNutritionContext({ ...race, plan: solved, stops });

    expect(block!.carbPerHour).toBeNull();
    expect(block!.fluidPerHour).toBeNull();
    expect(block!.mixPerStopG).toBeNull();
    expect(block!.reason).toMatch(/body weight/i);
  });

  it('reports an unsolvable plan rather than quoting grams for it', () => {
    const block = buildNutritionContext({
      ...race,
      plan: { ok: false, reason: 'no FTP on file' },
      stops,
      riderKg: 68
    });

    expect(block!.carbPerHour).toBeNull();
    expect(block!.reason).toBe('no FTP on file');
  });

  it('will not price a per-stop figure against zero stops', () => {
    const block = buildNutritionContext({
      ...race,
      plan: solved,
      stops: { count: 0, minutesEach: 0 },
      riderKg: 68
    });

    expect(block!.carbPerHour).toBeNull();
    expect(block!.reason).toMatch(/no stops/i);
  });

  it('flags a stop too short to be a feed, with the shortfall', () => {
    const block = buildNutritionContext({
      ...race,
      plan: solved,
      stops: { count: 3, minutesEach: 1 },
      riderKg: 68
    });

    // 1 minute is a bottle swap; the wording has to say so rather than just print grams
    expect(block!.stopBudget).toMatch(/short of a real feed stop/);
  });

  it('prints the ceiling when absorption clamps the demand', () => {
    const block = buildNutritionContext({
      ...race,
      plan: { ok: true, energyKJ: 40_000, movingSec: 3_600, stopSec: 0 },
      stops,
      riderKg: 68
    });

    expect(block!.carbIsCapped).toBe(true);
    const rendered = renderContext({
      week: {
        weekOf: '2026-10-04',
        rides: 1,
        distanceKm: 160,
        elevGainM: 0,
        movingSec: 3600,
        tss: 0,
        withPower: 1,
        includesDemo: false
      },
      athlete: { weightKg: 68, ftp: 265, heightCm: 178 },
      load: { ctl: null, atl: null, tsb: null, form: null, loaded: false },
      nutrition: block
    });
    expect(rendered).toMatch(/carb_g_per_h: \d+ \(ceiling/);
  });

  it('tells the model to stay silent on grams when no plan exists', () => {
    const block = buildNutritionContext({ ...race, plan: { ok: false, reason: 'no route profile' }, stops, riderKg: 68 });
    const ctx = buildCoachContext({
      rides: [rideRow],
      athlete: { weightKg: 68 },
      nutrition: block,
      now
    })!;
    const rendered = renderContext(ctx);

    expect(rendered).toMatch(/fueling: NOT AVAILABLE — no route profile/);
    expect(rendered).toMatch(/Do not suggest carbohydrate/);
    // no gram figure may leak into the prompt when the plan could not be solved
    expect(rendered).not.toMatch(/carb_g_per_h:/);
    expect(rendered).not.toMatch(/mix_g_per_stop:/);
  });

  it('omits the fueling section entirely for a weekly review', () => {
    const ctx = buildCoachContext({
      rides: [rideRow],
      athlete: { weightKg: 68 },
      now
    })!;

    expect(renderContext(ctx)).not.toMatch(/Race fueling/);
  });
});