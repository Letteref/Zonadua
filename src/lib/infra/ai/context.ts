/**
 * The context a coach model is allowed to see — M5's second DoD line.
 *
 * ## The rule this file exists to enforce
 *
 * ROADMAP §M5 requires the weekly review to "quote figures from the context", and
 * ROADMAP's own prerequisite for starting M5 was "only after the numbers are
 * trustworthy — if the context is wrong, the model invents". Both halves matter: a
 * context built from guesses poisons a correct model just as badly as a careless one.
 *
 * So every value here is either **measured** (read from a stored row), **derived**
 * (computed by a tested domain function from measured rows), or **absent** — and an
 * absent field is `null`, never a default. There is no path into this file that
 * produces a number nobody stored.
 *
 * The `synthetic` flag rides along on purpose. A review that quotes a fitness number
 * computed from seeded demo rides is not a review of this rider, and the prompt layer
 * needs to be able to say so rather than launder it.
 *
 * ## Why it is pure
 *
 * No Dexie, no fetch, no clock. Every input is passed in, so the whole builder is
 * testable with fixtures and cannot quietly read state the caller did not intend to
 * expose. The wiring to live queries lives with the caller.
 */

import { checkStopBudget, planNutrition } from '../../domain/nutrition';

/** Where a figure came from, so the prompt layer can label it honestly. */
export type Provenance = 'measured' | 'derived';

export interface Sourced<T> {
  value: T;
  /** how the number was obtained; never 'assumed' — that is what `null` is for */
  from: Provenance;
  /** the domain function or stored field this traces back to */
  source: string;
}

export interface WeekContext {
  /** ISO date of the Monday that starts the window */
  weekOf: string;
  rides: number;
  distanceKm: number;
  elevGainM: number;
  movingSec: number;
  /** summed training stress; 0 with a reason rather than null, because "no load" is a fact */
  tss: number;
  /** rides in the window that carried a power trace at all */
  withPower: number;
  /** true when any ride behind these figures is seeded demo data, not the rider's */
  includesDemo: boolean;
}

export interface AthleteContext {
  /** null when no weigh-in exists — the rider's mass is then unknown, not average */
  weightKg: number | null;
  /** null when no FTP has ever been logged */
  ftp: number | null;
  heightCm: number | null;
}

export interface LoadContext {
  /** 7-day exponentially weighted load */
  ctl: number | null;
  /** 1-day exponentially weighted load */
  atl: number | null;
  /** form: ctl − atl */
  tsb: number | null;
  /** `formState(tsb)`, or null when there is no load to classify */
  form: 'fresh' | 'detraining' | 'balanced' | 'productive' | 'peaking' | null;
  /** whether the rider has ridden enough for any of the above to mean anything */
  loaded: boolean;
}

export interface NutritionContext {
  /** the event these figures are for */
  raceName: string;
  /** distance_km */
  distanceKm: number;
  /** riding seconds the plan solved for, excluding stops */
  movingSec: number;
  /** energy the solved plan costs, kJ — the basis every gram below is derived from */
  energyKJ: number;
  /** g/h of carbohydrate, already clamped to what a gut absorbs; null when unfuellable */
  carbPerHour: number | null;
  /** true when the plan's raw demand exceeded that ceiling and was clamped */
  carbIsCapped: boolean;
  /** litres of fluid per hour, derived from body mass; null when unfuellable */
  fluidPerHour: number | null;
  /** grams of mix per stop at 60 g/L — the figure that goes on the bag */
  mixPerStopG: number | null;
  /** how many stops the plan already budgets; zero means the plan rides straight through */
  stopCount: number;
  /** `checkStopBudget`'s verdict, or null when there are no stops to budget */
  stopBudget: string | null;
  /**
   * Why this block is absent, when it is.
   *
   * Carried rather than thrown away because "no fueling plan" and "here is your fueling
   * plan" are different states and the rider is entitled to know which one they are
   * looking at before any model is asked to comment on it.
   */
  reason: string | null;
}

/** Local day key (YYYY-MM-DD in the user's zone), matching `pmc.ts` and `queries.svelte.ts`. */
const isoLocalDay = (d: Date): string => {
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const localDayStart = (d: Date): Date => {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
};

/**
 * The one-week window ending on `now`, Monday-based, as ISO day keys in the user's local zone.
 *
 * Local throughout, deliberately. rides are stored as local-naive wall-clock datetimes (the
 * Strava mapper writes `2026-10-01T06:30:00` from a `start_date` of `2026-10-01T06:30:00Z`),
 * so a window computed in UTC would silently shift a ride across the boundary for anyone not
 * on UTC. The first draft did exactly that — built the midnight with `Date.UTC`, then compared
 * it against local-naive datetimes.
 */
export function weekWindow(now: Date): { from: string; to: string; weekOf: string } {
  const end = new Date(now);
  const dow = end.getDay(); // 0 Sun … 6 Sat, local
  // Monday-based week: Monday=0 … Sunday=6
  const sinceMonday = (dow + 6) % 7;
  const start = localDayStart(new Date(end.getFullYear(), end.getMonth(), end.getDate() - sinceMonday));
  const to = isoLocalDay(end);
  return { from: isoLocalDay(start), to, weekOf: to };
}

/** Shape the caller passes in — deliberately not the Dexie row type, to keep this pure. */
export interface RideRow {
  date: string;
  distanceKm: number;
  elevGainM: number;
  movingSec: number;
  tss?: number;
  np?: number;
  synthetic?: boolean;
}

/**
 * Roll a set of rides into the week's totals.
 *
 * Rides outside the window are ignored rather than clamped in, so a window cannot
 * quietly accumulate last week's training and report it as this week's.
 */
export function buildWeekContext(rides: readonly RideRow[], now: Date): WeekContext {
  const { from, to, weekOf } = weekWindow(now);
  const inWindow = rides.filter((r) => r.date.slice(0, 10) >= from && r.date.slice(0, 10) <= to);

  let distanceKm = 0;
  let elevGainM = 0;
  let movingSec = 0;
  let tss = 0;
  let withPower = 0;
  let includesDemo = false;

  for (const r of inWindow) {
    distanceKm += Number.isFinite(r.distanceKm) ? r.distanceKm : 0;
    elevGainM += Number.isFinite(r.elevGainM) ? r.elevGainM : 0;
    movingSec += Number.isFinite(r.movingSec) ? r.movingSec : 0;
    if (Number.isFinite(r.tss)) tss += r.tss as number;
    if (r.np != null) withPower++;
    if (r.synthetic === true) includesDemo = true;
  }

  return {
    weekOf,
    rides: inWindow.length,
    distanceKm: Math.round(distanceKm * 10) / 10,
    elevGainM: Math.round(elevGainM),
    movingSec: Math.round(movingSec),
    tss: Math.round(tss),
    withPower,
    includesDemo
  };
}

/**
 * Build the whole context, or `null` when there is nothing a model could honestly be
 * asked about.
 *
 * An empty history is not a thin history — it is no history, and a review of it would be
 * a review of nothing. Returning `null` lets the caller render an empty state instead of
 * prompting a model to comment on zero rides.
 */
export function buildCoachContext(input: {
  rides: readonly RideRow[];
  athlete: { weightKg?: number; ftp?: number; heightCm?: number };
  /** ctl / atl / tsb / form from `computePmc`, when the caller has them */
  load?: { ctl: number | null; atl: number | null; tsb: number | null; form: LoadContext['form'] };
  /** race fueling, when the caller is briefing a specific event rather than the week */
  nutrition?: NutritionContext | null;
  now: Date;
}): CoachContext | null {
  const week = buildWeekContext(input.rides, input.now);

  // nothing to review: no rides this week *and* no load history to speak of
  if (week.rides === 0 && !(input.load?.ctl != null && input.load.ctl > 0)) return null;

  const athlete: AthleteContext = {
    weightKg: finiteOrNull(input.athlete.weightKg),
    ftp: finiteOrNull(input.athlete.ftp),
    heightCm: finiteOrNull(input.athlete.heightCm)
  };

  const load: LoadContext = {
    ctl: input.load ? finiteOrNull(input.load.ctl) : null,
    atl: input.load ? finiteOrNull(input.load.atl) : null,
    tsb: input.load ? finiteOrNull(input.load.tsb) : null,
    form: input.load?.form ?? null,
    loaded: (input.load?.ctl ?? 0) > 0
  };

  return { week, athlete, load, nutrition: input.nutrition ?? null };
}

export interface CoachContext {
  week: WeekContext;
  athlete: AthleteContext;
  load: LoadContext;
  /**
   * Race fueling, or `null` for a weekly review that is not about an event.
   *
   * Separate from the rest of the context on purpose. A weekly review can be written from
   * this week's rides alone; a race briefing cannot be written at all without a solved
   * plan, so its absence is a real limit on what the model is allowed to say — and that
   * limit has to be visible to the prompt rather than implied by a missing section.
   */
  nutrition: NutritionContext | null;
}

/**
 * Turn a solved plan into the fueling figures a briefing is allowed to quote.
 *
 * Every number here comes out of `planNutrition`, which is a tested function of the
 * rider's own mass and the plan's own energy. That is the whole point: g/h is the single
 * number a model is most likely to answer from population averages, and it is the number
 * a rider would act on at 5am. The model may phrase the result; it may not produce it.
 *
 * Returns a block carrying `reason` rather than `null` when the plan cannot fuel, so the
 * caller can say *which* input was missing instead of falling silent.
 */
export function buildNutritionContext(input: {
  raceName: string;
  distanceKm: number;
  plan: {
    ok: boolean;
    reason?: string;
    energyKJ?: number;
    movingSec?: number;
    stopSec?: number;
  };
  stops: { count: number; minutesEach: number };
  riderKg?: number;
}): NutritionContext | null {
  const base = {
    raceName: input.raceName,
    distanceKm: Math.round(input.distanceKm * 10) / 10,
    movingSec: Math.round(input.plan.movingSec ?? 0),
    energyKJ: Math.round(input.plan.energyKJ ?? 0),
    stopCount: input.stops.count,
    // null, never 0: an unmeasured gram figure printed as 0 would read as "eat nothing"
    carbPerHour: null,
    carbIsCapped: false,
    fluidPerHour: null,
    mixPerStopG: null,
    stopBudget: null
  };

  if (!input.plan.ok) {
    return { ...base, reason: input.plan.reason ?? 'the plan could not be solved' };
  }

  const plan = planNutrition({
    riderKg: input.riderKg,
    energyKJ: input.plan.energyKJ,
    movingSec: input.plan.movingSec,
    stopCount: input.stops.count,
    stopMinutes: input.stops.minutesEach
  });

  if (!plan) {
    // planNutrition refuses rather than guessing; report the missing input, not a number
    const missing = !input.riderKg ? 'body weight' : !input.plan.energyKJ ? 'the plan energy' : 'the planned duration';
    return { ...base, reason: `${missing} is not known, so no fueling plan can be computed` };
  }

  // No stops means fuel is carried from the start, which is a different plan and not one
  // this module can advise on. Saying so beats quoting a per-stop figure for zero stops.
  if (input.stops.count <= 0) {
    return { ...base, reason: 'the plan has no stops, so there is nothing to fuel at' };
  }

  const budget = checkStopBudget(input.stops.minutesEach);

  return {
    ...base,
    carbPerHour: plan.carbPerHour,
    carbIsCapped: plan.carbIsCapped,
    fluidPerHour: plan.fluidPerHour,
    mixPerStopG: plan.mixPerStopG,
    stopBudget: budget.adequate
      ? `each stop allows ${budget.minutesEach} min, enough to eat and drink`
      : `each stop allows only ${budget.minutesEach} min — ${budget.shortfallMin} min short of a real feed stop`,
    reason: null
  };
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Render the context as the compact, labelled block that goes into the prompt.
 *
 * Deliberately a plain key/value list rather than prose: a model asked to "summarise"
 * free text will invent around it, while one handed a table of figures and their sources
 * has nothing to fill in. Absent values are printed as `not measured`, which is the one
 * phrase the prompt forbids from being paraphrased into a number.
 */
export function renderContext(ctx: CoachContext): string {
  const n = (v: number | null, unit = ''): string => (v == null ? 'not measured' : `${v}${unit}`);
  const lines: string[] = [
    '# Rider context (measured or derived only)',
    '',
    '## This week',
    `week_of: ${ctx.week.weekOf}`,
    `rides: ${ctx.week.rides}`,
    `distance_km: ${ctx.week.distanceKm}`,
    `elevation_gain_m: ${ctx.week.elevGainM}`,
    `moving_time_min: ${Math.round(ctx.week.movingSec / 60)}`,
    `tss: ${ctx.week.tss}`,
    `rides_with_power: ${ctx.week.withPower}`,
    `includes_demo_data: ${ctx.week.includesDemo}`,
    '',
    '## Athlete',
    `weight_kg: ${n(ctx.athlete.weightKg)}`,
    `ftp_w: ${n(ctx.athlete.ftp)}`,
    `height_cm: ${n(ctx.athlete.heightCm)}`,
    '',
    '## Training load',
    `ctl: ${n(ctx.load.ctl)}`,
    `atl: ${n(ctx.load.atl)}`,
    `tsb: ${n(ctx.load.tsb)}`,
    `form: ${ctx.load.form ?? 'not measured'}`,
    `has_load_history: ${ctx.load.loaded}`
  ];

  // The fueling block is printed only when one exists, and printed with its reason when
  // the plan could not produce one. An empty section would read as "nothing to say" and
  // invite the model to fill the gap; a section that says *why* it is empty cannot be
  // mistaken for a measured zero.
  if (ctx.nutrition) {
    const f = ctx.nutrition;
    lines.push(
      '',
      '## Race fueling',
      `race: ${f.raceName}`,
      `distance_km: ${f.distanceKm}`,
      `planned_moving_min: ${Math.round(f.movingSec / 60)}`,
      `planned_energy_kj: ${f.energyKJ}`
    );
    if (f.reason) {
      lines.push(`fueling: NOT AVAILABLE — ${f.reason}`);
      lines.push('Do not suggest carbohydrate, fluid or feeding amounts for this race.');
    } else {
      lines.push(`carb_g_per_h: ${f.carbPerHour}${f.carbIsCapped ? ' (ceiling — gut absorption limit)' : ''}`);
      lines.push(`fluid_l_per_h: ${f.fluidPerHour}`);
      lines.push(`mix_g_per_stop: ${f.mixPerStopG}`);
      lines.push(`stops_planned: ${f.stopCount}`);
      lines.push(`stop_budget: ${f.stopBudget}`);
    }
  }

  return lines.join('\n');
}
