/**
 * Performance Management Chart — ARCHITECTURE.md §5.2 (F4).
 *
 * CTL = EMA of daily TSS over 42 days, ATL = EMA over 7 days, TSB = CTL − ATL.
 * Pure and deterministic: `now` is injectable so tests and replays are stable.
 */

export const CTL_TAU = 42;
export const ATL_TAU = 7;

export interface PmcInput {
  /** ISO datetime or ISO date */
  date: string;
  tss?: number;
}

export interface PmcPoint {
  /** ISO date (YYYY-MM-DD) */
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
}

const isoLocalDay = (d: Date): string => {
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/** Bucket TSS by calendar day in the user's local zone, so a ride logged as `2026-10-01T06:30` lands on the day the rider actually rode — not the UTC day `toISOString` would assign for, say, 06:30 in Indochina time (23:30 UTC the day before). */
export function dailyTss(items: readonly PmcInput[]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const item of items) {
    const key = isoLocalDay(new Date(item.date));
    byDay.set(key, (byDay.get(key) ?? 0) + (item.tss ?? 0));
  }
  return byDay;
}

/**
 * Daily CTL/ATL/TSB for the `days` window ending today.
 * The window starts at CTL=ATL=0 so a fresh install ramps up from zero rather than
 * inheriting a phantom fitness level.
 */
export function computePmc(items: readonly PmcInput[], days = 90, now = new Date()): PmcPoint[] {
  const byDay = dailyTss(items);
  const out: PmcPoint[] = [];
  let ctl = 0;
  let atl = 0;

  const start = new Date(now);
  start.setDate(start.getDate() - days);

  for (let i = 0; i <= days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const load = byDay.get(isoLocalDay(d)) ?? 0;
    ctl += (load - ctl) / CTL_TAU;
    atl += (load - atl) / ATL_TAU;
    out.push({
      date: isoLocalDay(d),
      ctl: round1(ctl),
      atl: round1(atl),
      tsb: round1(ctl - atl)
    });
  }
  return out;
}

/** Fitness state implied by TSB — the labels the dashboard readiness ring uses. */
export function formState(tsb: number): 'fresh' | 'detraining' | 'balanced' | 'productive' | 'peaking' {
  if (tsb < -30) return 'fresh';
  if (tsb < -10) return 'detraining';
  if (tsb <= 5) return 'balanced';
  if (tsb <= 25) return 'productive';
  return 'peaking';
}

/**
 * Whether the PMC window holds any training load at all.
 *
 * `formState` reads TSB, and it cannot tell a measured zero from an absent one. `computePmc`
 * starts the window at CTL=ATL=0 on purpose — "a fresh install ramps up from zero rather than
 * inheriting a phantom fitness level" — so a rider who has never ridden comes out of it with a
 * full-length curve of zeros. `formState(0)` is `balanced`, so that rider was being told their
 * fitness and fatigue are perfectly in balance. That is a confident-sounding claim about
 * someone who has never trained, and it is worse than showing nothing.
 *
 * The test is made against the series rather than the inputs on purpose: the series is already
 * scoped to the window `computePmc` walked, so this cannot disagree with the curve drawn beside
 * it. Checking the raw activity list instead would call a two-year-old ride "load in the
 * window" while the curve in front of the rider was still flat zero.
 *
 * A rest of even a few weeks is not caught by this, and should not be. CTL decays by
 * `(CTL_TAU-1)/CTL_TAU` per day, so anything inside the window still leaves a measurable tail —
 * a rider who trained in March and stopped in May genuinely has decayed, and TSB≈0 means their
 * fitness and fatigue really have converged. Only a window with *nothing* in it is unreadable.
 */
export function hasPmcLoad(series: readonly PmcPoint[]): boolean {
  return series.some((p) => p.ctl > 0);
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}