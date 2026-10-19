/**
 * Coach guidance — deterministic, from measured data only.
 *
 * ## The contract
 *
 * The app must be able to show useful coaching text with **no API key at all**. So the
 * sentence is built here, deterministically, from figures the domain layer already
 * computes — the same rule `infra/ai/context.ts` enforces: every value is measured,
 * derived, or absent. An absent value produces a different sentence, never a guessed
 * number.
 *
 * The rider's optional AI key then gets exactly one job: **rephrase** the built sentence
 * into smoother prose. It is never asked for numbers — the rephrase prompt embeds the
 * same figures the sentence used, and the reply is verified against them by the same
 * `verifyNumbers` gate the weekly review uses. A blocked reply falls back to the built
 * sentence, so the widget can always say something true.
 *
 * ## Report vs prescription
 *
 * The card carries two clauses and each has exactly one job. `headline` says what the
 * data reads — the report. `advice` says **what to ride today**: duration, intensity
 * target and session structure, chosen from those same figures — the prescription.
 * Guidance that only restates the chart is a shorter chart, and the rider already has
 * the chart; a coach earns their seat by turning the reading into a session.
 *
 * Every *descriptive* number (CTL/ATL/TSB, week TSS, FTP and its age, intensity share,
 * wear) is measured or derived and belongs in `evidence`. Durances, intervals and
 * cadences in `advice` are prescriptions — recommendations about what to do, never
 * claims about the rider — which is why they sit outside the evidence line. The one
 * exception is a figure quoted from the data (the intensity share, the FTP factor),
 * which appears in evidence like any other measurement.
 *
 * ## Prescriptions are computed, not canned
 *
 * No sentence carries a fixed session structure. The *shape* of every prescription —
 * ride length, warm-up, work minutes, rep count, block length, opener sprints — is
 * computed below from the rider's own numbers: `avgRideMin30d` (how long they actually
 * ride), the TSS gap being closed, and the recent intensity share. A rider who averages
 * 45-minute spins is prescribed 45-minute structures; a bigger weekly gap earns a longer
 * ride; legs that already carry snap work get fewer opener sprints. With no 30-day
 * history, `NEUTRAL_RIDE_MIN` stands in — a documented neutral, not a guess dressed as
 * data. Intensity *levels* stay relative to the measured zones/FTP; only the shape
 * scales.
 *
 * ## Cycling, not generic workout
 *
 * These are prescriptions for **rides**, written the way a bike coach writes them: the
 * ride type (recovery spin, endurance ride, sweet spot block, threshold intervals,
 * openers, a race-pace block), where the efforts sit inside the ride, the power target
 * stated against FTP or the app's own zones, and how to turn the pedals (rpm, seated,
 * even pacing). Durations and intervals are shaped like a ride — warm-up, main set,
 * spin home — never like a gym workout of sets and reps.
 *
 * Pure: no Dexie, no fetch, no clock. `now` is injectable for tests.
 */

import { TWENTY_MINUTE_TEST_FACTOR } from './ftp';
import { formState } from './pmc';

export interface InsightInput {
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  /** TSB change over the last 7 days (points) */
  tsbDelta7d: number | null;
  /** this week's totals */
  weekTss: number;
  weekKm: number;
  weekRides: number;
  /** weekly TSS target the dashboard already derives */
  tssTarget: number;
  /** the rider's latest FTP, if one is logged */
  ftp: number | null;
  /** days since the FTP was logged; null when no FTP exists */
  ftpAgeDays: number | null;
  /** share of sampled time at or above sweet spot over the last 30 days, 0–100 */
  hiShare30d: number | null;
  /** soonest race, when one is planned */
  race: { name: string; days: number } | null;
  /** worst component wear, when anything is close to its interval */
  wear: { name: string; pct: number } | null;
  /**
   * Mean moving minutes per ride over the last 30 days — the rider's own ride length,
   * which every prescribed duration is scaled from. Null when no rides exist yet.
   */
  avgRideMin30d: number | null;
}

export type InsightSeverity = 'critical' | 'watch' | 'good';

export interface CoachInsight {
  severity: InsightSeverity;
  /** short kicker, e.g. "Fatigue alert" */
  tag: string;
  /** the headline clause — data claims only */
  headline: string;
  /** the recommendation clause — one clear, rideable session */
  advice: string;
  /** the evidence line, restating the exact figures used */
  evidence: string;
}

/**
 * Design assumption (stated, not hidden): above this share of time at/above sweet spot
 * in the last 30 days, the intensity budget is treated as spent and the prescription
 * switches from intervals to volume. 25% of saddle time at ≥90% FTP is a lot of
 * threshold work for any athlete — polarized plans sit well below it — so a rider past
 * it is being told to stop adding, not to back off because something is wrong.
 */
const INTENSITY_BUDGET_PCT = 25;

/** Gap (TSS) one well-built ride can realistically close; above this it takes two. */
const ONE_RIDE_GAP_TSS = 90;

// ---------- prescription geometry ----------
// Every duration, rep count and block length in `advice` comes from these formulas —
// nothing structural is a fixed string. Intensity *levels* (zones, % of FTP) stay
// relative to measured data; the *shape* scales to the rider's own riding.

/** No 30-day history: an honest neutral hour, stated as the default it is. */
const NEUTRAL_RIDE_MIN = 60;
/** Average intensity factor assumed when solving a ride against a TSS gap. */
const IF_ENDURANCE = 0.8;

const round5 = (n: number): number => Math.round(n / 5) * 5;

/** A ride length for an intent: the rider's own average × factor, clamped to the band. */
function rideMin(avg: number | null, factor: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, round5((avg ?? NEUTRAL_RIDE_MIN) * factor)));
}

/**
 * Minutes of riding needed to accrue `tss` points at an average intensity factor —
 * TSS ≈ hours × IF² × 100 for a steadily-paced ride, inverted for minutes.
 */
function minutesForTss(tss: number, ifValue: number): number {
  return round5((tss / (ifValue * ifValue * 100)) * 60);
}

/** Split `work` minutes into 2 blocks (up to 45 min) or 3 (above); blocks even at ≥8. */
function repBlocks(work: number): { reps: number; block: number } {
  const reps = work > 45 ? 3 : 2;
  const raw = work / reps;
  return { reps, block: raw < 8 ? Math.max(3, Math.round(raw)) : Math.round(raw / 2) * 2 };
}

/**
 * Sprint-openers before a race: fewer when the last 30 days already carried snap work
 * (the legs know the movement), more when intensity has been scarce. Absent intensity
 * history → the classical count, stated as the neutral it is.
 */
function openerReps(hiShare30d: number | null): number {
  if (hiShare30d === null) return 3;
  return hiShare30d >= 15 ? 2 : hiShare30d >= 5 ? 3 : 4;
}

/** Fast-pedal drills inside an easy ride, scaled to how long the ride actually is. */
function pedalReps(ride: number): number {
  return Math.min(4, Math.max(2, Math.round(ride / 25)));
}

export function buildCoachInsight(i: InsightInput): CoachInsight {
  const tsb = i.tsb;
  const hi = i.hiShare30d;
  const intensitySpent = hi !== null && hi >= INTENSITY_BUDGET_PCT;

  // ---- pick the dominant story ----
  // Priority: a race that is close, then a fatigue spike, then freshness, then the
  // weekly target, then FTP staleness, then the generic "keep riding" line. Whichever
  // story wins, `headline` reports it and `advice` prescribes the session that fits it.
  if (i.race && i.race.days <= 14) {
    const d = i.race.days;
    const when = d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;

    let advice: string;
    if (tsb !== null && tsb <= -20) {
      // deep fatigue outranks the race plan: intervals into a hole never got anyone
      // fresher on the start line. The spin scales to the rider's own rides; the
      // openers thin out as the legs get deeper.
      const spin = rideMin(i.avgRideMin30d, 0.6, 30, 60);
      advice = `Form is already digging (TSB ${Math.round(tsb)}) — no hard efforts now. Ride an easy ${spin} min at Zone 1–2, 90+ rpm, with ${openerReps(i.hiShare30d)}×10 s single-gear jumps to keep the snap, then fuel up; the freshness comes back on its own.`;
    } else if (d <= 1) {
      const spin = rideMin(i.avgRideMin30d, 0.5, 20, 45);
      advice = `Last spin before the gun: ${spin} min easy at Zone 1–2, 95+ rpm, with ${openerReps(i.hiShare30d)}×10 s single-gear sprints to wake the legs and an easy roll home. Nothing that leaves you gasping — the speed is already in the legs.`;
    } else if (d <= 7) {
      const ride = rideMin(i.avgRideMin30d, 1, 50, 90);
      const { reps, block } = repBlocks(round5(ride * 0.15));
      advice = `Ride today: an easy ${ride} min at Zone 2 with one race-pace block in the middle — ${reps}×${block} min at race pace, ${block >= 8 ? 5 : 3} min easy spin between, then spin home. The two days before the start are endurance spins only.`;
    } else {
      const ride = rideMin(i.avgRideMin30d, 1, 60, 105);
      const { reps, block } = repBlocks(round5(ride * 0.25));
      advice = `Ride today: the last hard ride of the block — ${ride} min with ${reps}×${block} min at FTP watts in the middle, 5 min easy spin between each, last ${Math.max(5, round5(ride * 0.15))} min home easy. After that only endurance spins and openers; hard riding in the final three days never arrives on race day.`;
    }

    return {
      severity: 'critical',
      tag: 'Race week',
      headline: `${i.race.name} is ${when}.`,
      advice,
      evidence: evidence(i)
    };
  }

  if (tsb !== null && i.atl !== null && i.tsbDelta7d !== null && tsb <= -25 && i.tsbDelta7d <= -10) {
    const cap = rideMin(i.avgRideMin30d, 0.6, 30, 60);
    return {
      severity: 'critical',
      tag: 'Fatigue alert',
      headline: `Form dropped ${Math.abs(i.tsbDelta7d)} points this week — you're running deep in the red (TSB ${tsb}).`,
      advice:
        `Recovery ride only: ${cap} min maximum at Zone 1–2 power — easy gear, 90+ rpm, nothing harder than a gentle tempo roll. If the legs feel like lead, take the day off the bike; the fatigue clears either way and a day costs nothing.`,
      evidence: evidence(i)
    };
  }

  if (tsb !== null && tsb >= 15) {
    // freshness decides *whether* to do the session; the intensity share decides
    // *which* one — fresh legs on a spent budget get volume, not intervals.
    const advice = intensitySpent
      ? (() => {
          const volume = rideMin(i.avgRideMin30d, 1.2, 75, 150);
          return `Fresh legs, spent budget: ${hi}% of the last 30 days at or above sweet spot — skip the intervals. Ride ${volume} min at Zone 2 power at 85–95 rpm with 3×1 min fast pedals every 20 min; the snap is already there and this keeps it.`;
        })()
      : (() => {
          const ride = rideMin(i.avgRideMin30d, 1, 60, 120);
          const warm = round5(ride * 0.2);
          const { reps, block } = repBlocks(round5(ride * 0.5));
          return `Spend the window on the bike: threshold ride — ${ride} min in the saddle: ${warm} min warm-up with 2×1 min fast pedals, then ${reps}×${block} min at FTP watts with 5 min easy spinning between, 10 min to spin down. Keep it seated and even; one hard day and then endurance — freshness is why it works, not a licence for two.`;
        })();
    return {
      severity: 'good',
      tag: 'Fresh legs',
      headline: `Form is high (+${tsb} TSB) — you're carrying real freshness.`,
      advice: advice + wearCaution(i),
      evidence: evidence(i)
    };
  }

  if (i.weekTss > 0 && i.tssTarget > 0) {
    const pct = Math.round((i.weekTss / i.tssTarget) * 100);
    if (pct < 70) {
      const gap = i.tssTarget - i.weekTss;
      return {
        severity: 'watch',
        tag: 'Below target',
        headline: `You're at ${i.weekTss} of ~${i.tssTarget} TSS this week — ${pct}% of target.`,
        advice:
          gap <= ONE_RIDE_GAP_TSS
            ? (() => {
                const ride = minutesForTss(gap, IF_ENDURANCE);
                const { reps, block } = repBlocks(round5(ride * 0.3));
                return `One ride closes it: ${ride} min at Zone 2 with ${reps}×${block} min at 90% of FTP in the middle, easy gear that holds 95 rpm — that covers the ${gap} TSS you're short, without a hero effort.`;
              })()
            : (() => {
                const ride = minutesForTss(gap / 2, IF_ENDURANCE);
                const { reps, block } = repBlocks(round5(ride * 0.3));
                return `It takes two rides, not one heroic one: first a ${ride} min endurance ride at Zone 2 with ${reps}×${block} min at 90% of FTP in the middle, then the same again on your next ride day — together they cover the ${gap} TSS you're short.`;
              })(),
        evidence: evidence(i)
      };
    }
    if (pct > 125) {
      const spin = rideMin(i.avgRideMin30d, 0.75, 30, 60);
      return {
        severity: 'watch',
        tag: 'Big week',
        headline: `${i.weekTss} TSS this week — that's ${pct}% of your ~${i.tssTarget} target.`,
        advice:
          `Bank it: today is a rest day off the bike, or a ${spin} min spin at Zone 1 if the legs want to roll. Skip the interval ride you had lined up — the week's load is already banked.`,
        evidence: evidence(i)
      };
    }
    const advice = onTargetAdvice(i);
    return {
      severity: 'good',
      tag: 'On track',
      headline: `${i.weekTss} TSS this week, right around your ~${i.tssTarget} target.`,
      advice,
      evidence: evidence(i)
    };
  }

  if (i.ftp !== null && i.ftpAgeDays !== null && i.ftpAgeDays > 60) {
    return {
      severity: 'watch',
      tag: 'FTP check',
      headline: `Your ${i.ftp} W FTP was tested ${i.ftpAgeDays} days ago.`,
      // The one fixed structure in the module, and it is fixed on purpose: this is the
      // standardized test the app itself scores (`ftpFromTwentyMinuteTest`), not a
      // session choice — changing its shape would change what the number means.
      advice: `Book the test on the bike: 15 min warm-up with 3×1 min fast pedals, then 20 min all-out — even pace, no surges, hold it to the line — then a 10 min easy spin down. The app takes ${TWENTY_MINUTE_TEST_FACTOR} of that average as the new FTP and re-scores every ride since; it is what every TSS here divides by.`,
      evidence: evidence(i)
    };
  }

  return {
    severity: 'good',
    tag: 'Keep riding',
    headline: i.weekKm > 0
      ? `${i.weekKm} km across ${i.weekRides} ride${i.weekRides === 1 ? '' : 's'} this week.`
      : 'No rides logged this week yet.',
    advice:
      i.weekKm > 0
        ? (() => {
            const ride = rideMin(i.avgRideMin30d, 0.9, 50, 90);
            return `Next ride: ${ride} min at Zone 2, conversational the whole way at 85–95 rpm, with ${pedalReps(ride)}×1 min fast pedals every 15 min. Cheap in fatigue, and it keeps the log honest.`;
          })()
        : (() => {
            const ride = rideMin(i.avgRideMin30d, 0.85, 45, 75);
            return `Start the week: an easy ${ride} min at Zone 2, 90+ rpm, with ${pedalReps(ride)}×1 min fast pedals every 15 min. Log it, and every card here starts reading your own numbers instead of a fresh install.`;
          })(),
    evidence: evidence(i)
  };
}

/**
 * The session for a week that is already on target — chosen from the app's own form
 * banding (`formState`, the same read the hero's CURRENT FORM chip shows) crossed with
 * the intensity share, so this card can never contradict either figure beside it.
 * Durations scale to the rider's own ride length, as everywhere else.
 */
function onTargetAdvice(i: InsightInput): string {
  const hi = i.hiShare30d;
  const intensitySpent = hi !== null && hi >= INTENSITY_BUDGET_PCT;
  const form = i.tsb !== null ? formState(i.tsb) : null;
  const avg = i.avgRideMin30d;

  if (form === 'fresh') {
    const spin = rideMin(avg, 0.75, 45, 75);
    return `Form is deep in the red, so the plan bends: no intervals this week. Ride ${spin} min at Zone 1–2 power, 90+ rpm, each time out — easy miles only, and the freshness comes back by itself.`;
  }
  if ((form === 'productive' || form === 'peaking') && !intensitySpent) {
    const ride = rideMin(avg, 1, 60, 105);
    const { reps, block } = repBlocks(round5(ride * 0.25));
    return `On target with the legs to match: keep the plan — next ride is quality: ${ride} min with ${reps}×${block} min at FTP watts in the middle (or the same time in sweet spot if the legs feel flat), 5 min easy spin between each, then an endurance day after it.`;
  }
  if ((form === 'productive' || form === 'peaking') && intensitySpent) {
    const volume = rideMin(avg, 1.2, 75, 150);
    return `On target, but ${hi ?? 0}% of the month sits at or above sweet spot: next ride is distance, not intervals — ${volume} min at Zone 2 power, 85–95 rpm, and the week still lands on target.`;
  }
  const ride = rideMin(avg, 1, 60, 105);
  const { reps, block } = repBlocks(round5(ride * 0.25));
  return `Keep the rhythm: next ride is ${ride} min at Zone 2 endurance, conversational the whole way at 85–95 rpm, with ${reps}×${block} min sweet spot in the middle only if the legs answer back halfway. Weeks close on consistency, not on one big ride.`;
}

function wearCaution(i: InsightInput): string {
  if (!i.wear) return '';
  return ` One check first: the ${i.wear.name} is at ${Math.round(i.wear.pct * 100)}% of its service interval — look at it before you stand on the pedals.`;
}

function evidence(i: InsightInput): string {
  const parts: string[] = [];
  if (i.ctl !== null) parts.push(`CTL ${Math.round(i.ctl)}`);
  if (i.atl !== null) parts.push(`ATL ${Math.round(i.atl)}`);
  if (i.tsb !== null) parts.push(`TSB ${i.tsb > 0 ? '+' : ''}${Math.round(i.tsb)}`);
  if (i.hiShare30d !== null) parts.push(`${i.hiShare30d}% of time at/above sweet spot (30d)`);
  parts.push(`7d load ${i.weekTss} TSS`);
  return parts.join(' · ');
}

/**
 * The rephrase prompt. The model is shown the *same* figures the sentence used and is
 * told to keep them verbatim — so `verifyNumbers` can check the reply against the prompt
 * and a drifting answer is blocked rather than displayed.
 */
export function polishPrompt(insight: CoachInsight): { prompt: string; system: string } {
  const figures = insight.evidence;
  return {
    system:
      'You are a cycling coach writing in casual, encouraging English. You rewrite one given coaching message. Rules: keep every number EXACTLY as written, never add or change a number, never add new claims, reply with the rewritten message only (2-3 sentences).',
    prompt: `Figures you may use (must appear verbatim if mentioned): ${figures}

Rewrite this coaching message in natural, casual coach voice:
"${insight.headline} ${insight.advice}"`
  };
}
