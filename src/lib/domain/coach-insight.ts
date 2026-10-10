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
 * Pure: no Dexie, no fetch, no clock. `now` is injectable for tests.
 */

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
}

export type InsightSeverity = 'critical' | 'watch' | 'good';

export interface CoachInsight {
  severity: InsightSeverity;
  /** short kicker, e.g. "Fatigue alert" */
  tag: string;
  /** the headline clause — data claims only */
  headline: string;
  /** the recommendation clause — one clear action */
  advice: string;
  /** the evidence line, restating the exact figures used */
  evidence: string;
}

export function buildCoachInsight(i: InsightInput): CoachInsight {
  // ---- pick the dominant story ----
  // Priority: a race that is close, then a fatigue spike, then freshness, then the
  // weekly target, then FTP staleness, then the generic "keep riding" line.
  if (i.race && i.race.days <= 14) {
    return {
      severity: 'critical',
      tag: 'Race week',
      headline: `${i.race.name} is ${i.race.days === 1 ? 'tomorrow' : `in ${i.race.days} days`}.`,
      advice:
        'Keep it short and easy from here — open legs, don\'t build new fitness this week. Eat and sleep like it matters, because it does.',
      evidence: evidence(i)
    };
  }

  if (i.tsb !== null && i.atl !== null && i.tsbDelta7d !== null && i.tsb <= -25 && i.tsbDelta7d <= -10) {
    return {
      severity: 'critical',
      tag: 'Fatigue alert',
      headline: `Form dropped ${Math.abs(i.tsbDelta7d)} points this week — you're running deep in the red (TSB ${i.tsb}).`,
      advice:
        'Back the intensity off today. Ride easy, spin the legs, and let the fatigue drain before you reach for the hard stuff again.',
      evidence: evidence(i)
    };
  }

  if (i.tsb !== null && i.tsb >= 15) {
    return {
      severity: 'good',
      tag: 'Fresh legs',
      headline: `Form is high (+${i.tsb} TSB) — you're carrying real freshness.`,
      advice:
        'This is the window to push. Take a structured session today while the legs are willing — the fitness is there to back it.',
      evidence: evidence(i)
    };
  }

  if (i.weekTss > 0 && i.tssTarget > 0) {
    const pct = Math.round((i.weekTss / i.tssTarget) * 100);
    if (pct < 70) {
      return {
        severity: 'watch',
        tag: 'Below target',
        headline: `You're at ${i.weekTss} of ~${i.tssTarget} TSS this week — ${pct}% of target.`,
        advice:
          'One steady ride closes most of the gap. Nothing heroic — 90 minutes in Zone 2 would do it.',
        evidence: evidence(i)
      };
    }
    if (pct > 125) {
      return {
        severity: 'watch',
        tag: 'Big week',
        headline: `${i.weekTss} TSS this week — that's ${pct}% of your ~${i.tssTarget} target.`,
        advice:
          'Strong work, but bank it: keep tomorrow easy so the week doesn\'t tip into deep fatigue.',
        evidence: evidence(i)
      };
    }
    return {
      severity: 'good',
      tag: 'On track',
      headline: `${i.weekTss} TSS this week, right around your ~${i.tssTarget} target.`,
      advice:
        'Keep the rhythm going — one more steady ride keeps the week balanced without stacking fatigue.',
      evidence: evidence(i)
    };
  }

  if (i.ftp !== null && i.ftpAgeDays !== null && i.ftpAgeDays > 60) {
    return {
      severity: 'watch',
      tag: 'FTP check',
      headline: `Your ${i.ftp} W FTP was tested ${i.ftpAgeDays} days ago.`,
      advice:
        'Numbers drift. A fresh 20-minute test would re-sharpen every TSS score in the app — five minutes to set up, twenty to ride.',
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
      'Get out for a spin — even an easy hour keeps the engine ticking over and the log honest.',
    evidence: evidence(i)
  };
}

function evidence(i: InsightInput): string {
  const parts: string[] = [];
  if (i.ctl !== null) parts.push(`CTL ${Math.round(i.ctl)}`);
  if (i.atl !== null) parts.push(`ATL ${Math.round(i.atl)}`);
  if (i.tsb !== null) parts.push(`TSB ${i.tsb > 0 ? '+' : ''}${Math.round(i.tsb)}`);
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
