/**
 * Race nutrition from the rider's own numbers — M5's third DoD line.
 *
 * ## Why this is a domain module and not a prompt
 *
 * The DoD asks the race briefing for "g/h and a stop strategy from the rider's
 * parameters". If those numbers came out of a language model they would be a plausible
 * average of a population, not a plan for this rider — and nothing on screen could tell
 * the difference, which is exactly the failure mode this app exists to avoid. So the
 * arithmetic happens here, in code with tests, and the model is only ever allowed to
 * phrase a result this file produced.
 *
 * ## The honesty rule
 *
 * Two inputs are genuinely required and neither is invented: body mass, and the energy
 * the solved plan says the ride costs. Both are optional in the type, because both can
 * legitimately be missing — a rider with no weigh-in has a body mass we do not know, and
 * a route with no solution has no energy figure. When either is absent the result is
 * `null` and the caller renders an unmeasured state. It never falls back to a textbook
 * rider, because a plan for 70 kg handed to someone who weighs 58 kg is worse than no
 * plan: it looks personal.
 *
 * ## Where the rates come from
 *
 * Carbohydrate absorption is conventionally capped near 90 g/h regardless of duration;
 * intakes above that are simply not absorbed, so this caps rather than scales freely.
 * That cap is what binds on a long hard day: carbohydrate can cover roughly a third of
 * expenditure there, never all of it, which is why a plan reports `carbIsCapped`
 * instead of quietly presenting its ceiling as a target the rider could hit.
 *
 * Fluid is scaled by body mass because sweat rate does. Both ranges are the broad
 * consensus figures used in endurance-sport guidance, and they are stated as ranges
 * rather than a single number precisely because they are guidance, not measurement —
 * the rider's own sweat rate is the one thing here nobody can derive from a profile.
 */

/** Conventional ceiling on usable carbohydrate absorption, g/h. */
export const MAX_CARB_G_PER_H = 90;
/**
 * Grams of carbohydrate per kJ of expenditure, when turning a ride's energy cost into a
 * grams-per-hour target.
 *
 * Carbohydrate yields 16 kJ/g, so 1.0 would mean covering the entire cost from carbs
 * alone. 0.021 is roughly what the 90 g/h ceiling represents against a hard ultra's
 * expenditure: 90 g is 1 440 kJ, about a third of a ~4 300 kJ/h hour. The cap is what
 * actually binds on long days — this coefficient only decides how quickly a plan gets
 * there, and why a short ride lands in the recommended 30–90 g/h band rather than at an
 * absurd multiple of what a gut can take.
 */
const CARB_G_PER_KJ = 0.021;
const CARB_MIN_G_PER_H = 30;
const CARB_MAX_G_PER_H = MAX_CARB_G_PER_H;
/** Fluid, litres per hour, per 10 kg of body mass, as a range. */
const FLUID_L_PER_H_PER_10KG = [0.4, 0.8] as const;
/** Concentration of a drink mix, grams of carbohydrate per litre of fluid. */
const DRINK_G_PER_L = 60;

/** Energy in kilojoules per gram of carbohydrate. */
const KJ_PER_G_CARB = 16;

export interface NutritionInput {
  /** rider body mass, kg — required; `undefined` means "not known", not "average" */
  riderKg?: number;
  /** energy the solved plan says the ride costs, kJ — required */
  energyKJ?: number;
  /** planned riding seconds, excluding stops — required, it sets the hours */
  movingSec?: number;
  /**
   * Stop policy the plan already uses. Fuel is delivered *at* these stops, so the
   * stop count is not a free variable here: the plan chose it for cut-off reasons and
   * nutrition has to fit inside it rather than add stops the rider will not make.
   */
  stopCount: number;
  /**
   * Minutes already budgeted per stop. Not read by {@link planNutrition} — see the note
   * there — and consumed instead by {@link checkStopBudget}.
   */
  stopMinutes: number;
}

export interface NutritionPlan {
  /** g/h of carbohydrate to drink and eat across the ride */
  carbPerHour: number;
  /** litres of fluid per hour */
  fluidPerHour: number;
  /** grams of carbohydrate per stop, spread over the planned stops */
  carbPerStopG: number;
  /** litres of fluid per stop */
  fluidPerStopL: number;
  /** grams of mix per stop at {@link DRINK_G_PER_L} — the number that goes on the bag */
  mixPerStopG: number;
  /** the carbohydrate figure is a ceiling, so it is labelled as one */
  carbIsCapped: boolean;
  /** total hours of riding the per-hour figures apply to */
  hours: number;
}

/**
 * Build the fueling plan, or return `null` when an input it needs is missing.
 *
 * `null` is the honest answer and not a failure: the caller shows an unmeasured state
 * with a reason, exactly as it does for a race with no baseline.
 */
export function planNutrition(input: NutritionInput): NutritionPlan | null {
  // `stopMinutes` is deliberately not read here. It cannot change the quantities: the
  // per-stop grams are the ride's total divided by the stops, and whether a stop lasts
  // 1 or 5 minutes does not alter how much has to be taken on at it. What the minutes do
  // decide is whether a stop is long enough to *take* it on, which is a separate question
  // answered by `checkStopBudget`.
  const { riderKg, energyKJ, movingSec, stopCount } = input;

  if (!Number.isFinite(riderKg) || (riderKg as number) <= 0) return null;
  if (!Number.isFinite(energyKJ) || (energyKJ as number) <= 0) return null;
  if (!Number.isFinite(movingSec) || (movingSec as number) <= 0) return null;

  const hours = (movingSec as number) / 3600;
  if (hours <= 0) return null;

  const perStop = Math.max(1, stopCount);

  // Carbohydrate: enough to cover the ride's cost, clamped to what a gut absorbs and to
  // the range endurance guidance actually recommends.
  const rawCarbPerHour = (energyKJ as number) * CARB_G_PER_KJ / hours;
  const carbPerHour = Math.min(CARB_MAX_G_PER_H, Math.max(CARB_MIN_G_PER_H, rawCarbPerHour));
  const carbIsCapped = rawCarbPerHour > CARB_MAX_G_PER_H;

  // Fluid scales with body mass, because sweat rate does. Deliberately a midpoint of the
  // guidance range rather than its edge: the rider's own sweat rate is unknown here, and
  // the honest way to show an unknown is the middle of what is plausible.
  const fluidPerHour =
    ((FLUID_L_PER_H_PER_10KG[0] + FLUID_L_PER_H_PER_10KG[1]) / 2) * ((riderKg as number) / 10);

  const carbPerStopG = Math.round((carbPerHour * hours) / perStop);
  const fluidPerStopL = (fluidPerHour * hours) / perStop;

  return {
    carbPerHour: Math.round(carbPerHour),
    fluidPerHour: Math.round(fluidPerHour * 10) / 10,
    carbPerStopG,
    fluidPerStopL: Math.round(fluidPerStopL * 100) / 100,
    mixPerStopG: Math.round((fluidPerStopL * DRINK_G_PER_L) / 10) * 10,
    carbIsCapped,
    hours: Math.round(hours * 100) / 100
  };
}

/**
 * Does the planned stop budget leave room to actually take this on?
 *
 * A stop long enough to eat, drink and get back on the bike is worth 3–5 minutes;
 * anything under that is a bottle swap, not a feed. The result carries the gap rather
 * than a bare verdict so the caller can say *what is short*, which is the difference
 * between a usable warning and an unexplained number.
 */
export interface StopBudget {
  /** minutes per stop the policy allows */
  minutesEach: number;
  /** whether that leaves a usable feed stop */
  adequate: boolean;
  /** minutes a real feed needs beyond what is budgeted; 0 when adequate */
  shortfallMin: number;
}

/** A stop that lets a rider eat, drink and settle is worth this many minutes. */
export const MIN_FEED_STOP_MIN = 3;

export function checkStopBudget(minutesEach: number): StopBudget {
  const clamped = Math.max(0, minutesEach);
  const adequate = clamped >= MIN_FEED_STOP_MIN;
  return {
    minutesEach: clamped,
    adequate,
    shortfallMin: adequate ? 0 : Math.round((MIN_FEED_STOP_MIN - clamped) * 10) / 10
  };
}

/**
 * Energy in kJ the planned carbohydrate covers, for comparing against what the ride
 * actually costs. Exposed so a test can assert the per-stop figures sum back to a whole
 * ride's worth rather than trusting that arithmetic implicitly.
 */
export function coveredKJ(plan: NutritionPlan): number {
  return Math.round(plan.carbPerHour * plan.hours * KJ_PER_G_CARB);
}

/** Grams of carbohydrate across the whole ride. */
export function totalCarbG(plan: NutritionPlan): number {
  return Math.round(plan.carbPerHour * plan.hours);
}
