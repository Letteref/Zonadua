/**
 * Body trend series — PRD F2-AC2 ("Grafik tren berat & FTP ter-render dengan overlay
 * satu sama lain").
 *
 * Weight and FTP live in different units and scales, so they are returned as two
 * independent series over one shared time axis. Keeping them separate here (rather than
 * normalising inside the component) means the chart can label both axes honestly.
 */

export interface TrendInput {
  date: string; // ISO date
  kg?: number;
  ftp?: number;
}

export interface TrendPoint {
  /** days since the first point, for the x axis */
  t: number;
  /** ISO date for tooltips/labels */
  date: string;
  /** rider weight (kg) on that day, if logged */
  kg?: number;
  /** FTP (W) in force on that day, if known */
  ftp?: number;
}

export interface TrendSeries {
  points: TrendPoint[];
  weight: { t: number; kg: number }[];
  ftp: { t: number; w: number }[];
  /** linear slope of weight in kg per week, over the logged range */
  kgPerWeek: number;
  /** change in FTP across the series (W) */
  ftpDelta: number;
}

const DAY_MS = 86_400_000;

/**
 * Merge weight logs and FTP history into one timeline.
 *
 * FTP is a *step* function — the value in force carries forward until the next test —
 * so it is forward-filled across weight-log dates. Weight is sparse by nature (monthly
 * at best) and is never interpolated here: a straight line between two weigh-ins is a
 * claim the athlete never made.
 */
export function buildTrend(
  weights: readonly { date: string; kg: number }[],
  ftpHistory: readonly { date: string; ftp: number }[],
  now = new Date()
): TrendSeries {
  const w = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  const f = [...ftpHistory].sort((a, b) => a.date.localeCompare(b.date));
  if (w.length === 0 && f.length === 0) {
    return { points: [], weight: [], ftp: [], kgPerWeek: 0, ftpDelta: 0 };
  }

  const dates = [...new Set([...w.map((x) => x.date.slice(0, 10)), ...f.map((x) => x.date.slice(0, 10))])].sort();

  const first = dates[0];
  const weightByDate = new Map(w.map((x) => [x.date.slice(0, 10), x.kg]));
  const ftpByDate = new Map(f.map((x) => [x.date.slice(0, 10), x.ftp]));

  // last known FTP at or before each point date, plus today's row so the current value shows
  const timeline = [...dates, now.toISOString().slice(0, 10)].sort();
  const seen = new Set<string>();
  const points: TrendPoint[] = [];
  const weight: { t: number; kg: number }[] = [];
  const ftp: { t: number; w: number }[] = [];

  let currentFtp: number | undefined;
  for (const d of timeline) {
    const explicit = ftpByDate.get(d);
    if (explicit !== undefined) currentFtp = explicit;
    const kg = weightByDate.get(d);
    if (explicit === undefined && kg === undefined && seen.has(d)) continue;
    seen.add(d);

    const p: TrendPoint = { t: daysBetween(first, d), date: d };
    if (kg !== undefined) p.kg = kg;
    if (currentFtp !== undefined) p.ftp = currentFtp;
    points.push(p);
    if (kg !== undefined) weight.push({ t: p.t, kg });
    if (currentFtp !== undefined) ftp.push({ t: p.t, w: currentFtp });
  }

  const kgPerWeek =
    weight.length >= 2
      ? Math.round(((weight.at(-1)!.kg - weight[0].kg) / ((weight.at(-1)!.t - weight[0].t) / 7)) * 100) / 100
      : 0;
  const ftpDelta =
    ftp.length >= 2 ? ftp.at(-1)!.w - ftp[0].w : ftp.length === 1 ? 0 : 0;

  return { points, weight, ftp, kgPerWeek, ftpDelta };
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}