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

/** UTC day key, matching how activity dates are stored and bucketed everywhere else. */
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The one-week window ending on `now`, Monday-based, as ISO day keys.
 *
 * UTC throughout, deliberately. Ride dates are stored and bucketed in UTC
 * (`pmc.ts`'s `isoDay`, and every other day key in the data layer), so a week boundary
 * computed in local time would compare a local midnight against UTC-stored dates and
 * silently shift a ride into the neighbouring week for anyone not on UTC. The first draft
 * did exactly that — built the date with `setDate`/`setHours`, which are local, then
 * stringified it with `toISOString()`, which is UTC.
 */
export function weekWindow(now: Date): { from: string; to: string; weekOf: string } {
  const end = new Date(now);
  const sinceMonday = (end.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - sinceMonday));
  const to = isoDay(end);
  return { from: isoDay(start), to, weekOf: to };
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

  return { week, athlete, load };
}

export interface CoachContext {
  week: WeekContext;
  athlete: AthleteContext;
  load: LoadContext;
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
  return lines.join('\n');
}
