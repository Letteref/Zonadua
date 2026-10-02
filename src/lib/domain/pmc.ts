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

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Bucket TSS by calendar day (UTC), so two rides on one date sum instead of overwrite. */
export function dailyTss(items: readonly PmcInput[]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const item of items) {
    const key = isoDay(new Date(item.date));
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
    const load = byDay.get(isoDay(d)) ?? 0;
    ctl += (load - ctl) / CTL_TAU;
    atl += (load - atl) / ATL_TAU;
    out.push({
      date: isoDay(d),
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

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}