import { describe, expect, it } from 'vitest';
import {
  MAX_CARB_G_PER_H,
  MIN_FEED_STOP_MIN,
  checkStopBudget,
  coveredKJ,
  planNutrition,
  totalCarbG
} from '../nutrition';

/**
 * Nutrition is the first place a language model could have produced these numbers, and
 * that is exactly why they are here instead. The tests therefore assert two different
 * kinds of thing: that the arithmetic is right, and — more importantly — that the module
 * refuses to produce a number at all when an input it needs is missing.
 */

/** A 200 km / 6 h solve at a typical 70 kg rider, the shape the briefing targets. */
const LONG_ULTRA = {
  riderKg: 70,
  energyKJ: 26_000,
  movingSec: 6 * 3600,
  stopCount: 4,
  stopMinutes: 5
};

describe('planNutrition', () => {
  it('scales carbohydrate to the ride cost and reports it per hour', () => {
    const plan = planNutrition(LONG_ULTRA)!;
    expect(plan.hours).toBe(6);
    // 26,000 kJ over 6 h at 0.021 g/kJ lands near 91 g/h, just over the ceiling
    expect(plan.carbPerHour).toBe(MAX_CARB_G_PER_H);
    expect(plan.carbIsCapped).toBe(true);
  });

  it('caps carbohydrate at what a gut absorbs and says that it capped it', () => {
    const plan = planNutrition({ ...LONG_ULTRA, energyKJ: 90_000 })!;
    // a capped plan that does not say it was capped would read as a figure the rider
    // can actually hit, and it is not one
    expect(plan.carbPerHour).toBe(MAX_CARB_G_PER_H);
    expect(plan.carbIsCapped).toBe(true);
  });

  it('does not cap a short ride whose cost fits inside the ceiling', () => {
    const plan = planNutrition({ ...LONG_ULTRA, energyKJ: 4_000, movingSec: 2 * 3600 })!;
    // 4,000 kJ over 2 h is 42 g/h — inside the recommended band rather than at the ceiling
    expect(plan.carbIsCapped).toBe(false);
    expect(plan.carbPerHour).toBeLessThan(MAX_CARB_G_PER_H);
    expect(plan.carbPerHour).toBeGreaterThanOrEqual(30);
  });

  it('keeps carbohydrate under the energy carbohydrate can physically yield', () => {
    // Carbohydrate is 16 kJ/g, so no plan may hand back more gram-hours than the ride's
    // own energy could have supplied. A cheap ride stretched over a long day is the case
    // that catches it: the rate is small enough to stay under the absorption cap, so a
    // wrong coefficient silently proposes fuel the rider did not burn.
    const plan = planNutrition({ ...LONG_ULTRA, energyKJ: 2_000, movingSec: 4 * 3600 })!;
    expect(plan.carbPerHour * plan.hours * 16).toBeLessThanOrEqual(2_000);
  });

  it('scales fluid with body mass, since sweat rate does', () => {
    const light = planNutrition({ ...LONG_ULTRA, riderKg: 55 })!;
    const heavy = planNutrition({ ...LONG_ULTRA, riderKg: 90 })!;
    expect(heavy.fluidPerHour).toBeGreaterThan(light.fluidPerHour);
    // the midpoint of the 0.4–0.8 L/h per 10 kg guidance range is 0.6, so 90 kg → 5.4 L/h
    expect(heavy.fluidPerHour).toBeCloseTo(5.4, 1);
    expect(light.fluidPerHour).toBeCloseTo(3.3, 1);
  });

  it('spreads the ride across the stops the plan already budgeted', () => {
    const two = planNutrition({ ...LONG_ULTRA, stopCount: 2 })!;
    const four = planNutrition({ ...LONG_ULTRA, stopCount: 4 })!;
    // the total is fixed by the ride; only its division changes
    expect(two.carbPerStopG).toBeGreaterThan(four.carbPerStopG);
    expect(two.carbPerStopG + 0).toBeGreaterThan(0);
  });

  it('reports a per-stop bag figure a rider could actually weigh out', () => {
    const plan = planNutrition(LONG_ULTRA)!;
    // rounded to 10 g so it reads as a scoop rather than a number to compute mid-ride,
    // and large enough that a stop carrying it is a real feed
    expect(plan.mixPerStopG % 10).toBe(0);
    expect(plan.mixPerStopG).toBeGreaterThan(0);
  });

  it('has per-stop figures that sum back to the whole ride', () => {
    const stopCount = 4;
    const plan = planNutrition({ ...LONG_ULTRA, stopCount })!;
    // if the per-stop figure and the per-hour figure disagree, the briefing would quote a
    // total the rider cannot hit by following the per-stop numbers — the exact failure
    // this module exists to prevent, so it is asserted rather than assumed
    const fromStops = plan.carbPerStopG * stopCount;
    const fromRate = totalCarbG(plan);
    expect(Math.abs(fromStops - fromRate) / fromRate).toBeLessThan(0.02);
    expect(coveredKJ(plan)).toBeGreaterThan(0);
  });

  it('returns null rather than a number when body mass is unknown', () => {
    // a rider with no weigh-in has a mass we do not know; a textbook average handed to
    // someone 12 kg lighter is worse than no plan, because it looks personal
    expect(planNutrition({ ...LONG_ULTRA, riderKg: undefined })).toBeNull();
    expect(planNutrition({ ...LONG_ULTRA, riderKg: 0 })).toBeNull();
    expect(planNutrition({ ...LONG_ULTRA, riderKg: NaN })).toBeNull();
  });

  it('returns null when the ride has no solved energy or no duration', () => {
    expect(planNutrition({ ...LONG_ULTRA, energyKJ: undefined })).toBeNull();
    expect(planNutrition({ ...LONG_ULTRA, energyKJ: 0 })).toBeNull();
    expect(planNutrition({ ...LONG_ULTRA, movingSec: undefined })).toBeNull();
    expect(planNutrition({ ...LONG_ULTRA, movingSec: 0 })).toBeNull();
  });

  it('treats a zero-stop plan as one stop rather than dividing by zero', () => {
    const plan = planNutrition({ ...LONG_ULTRA, stopCount: 0 })!;
    expect(Number.isFinite(plan.carbPerStopG)).toBe(true);
    expect(Number.isFinite(plan.fluidPerStopL)).toBe(true);
  });
});

describe('checkStopBudget', () => {
  it('calls a 3-minute-or-longer stop adequate and names the threshold', () => {
    expect(MIN_FEED_STOP_MIN).toBe(3);
    expect(checkStopBudget(5).adequate).toBe(true);
    expect(checkStopBudget(3).adequate).toBe(true);
    expect(checkStopBudget(5).shortfallMin).toBe(0);
  });

  it('quantifies the shortfall instead of only saying it is inadequate', () => {
    const budget = checkStopBudget(1);
    expect(budget.adequate).toBe(false);
    expect(budget.shortfallMin).toBe(2);
  });

  it('never reports a negative budget from a nonsense input', () => {
    expect(checkStopBudget(-5).minutesEach).toBe(0);
    expect(checkStopBudget(0).adequate).toBe(false);
  });
});
