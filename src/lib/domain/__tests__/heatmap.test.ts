import { describe, expect, it } from 'vitest';
import { buildHeatmap, heatLevel, HEATMAP_WEEKS } from '../heatmap';
import { isoLocalDay } from '../pmc';

// Wednesday 2026-10-07 at local noon — a mid-week "today" is exactly the case where the
// old inline grid silently dropped the current week until Saturday arrived.
const NOW = new Date(2026, 9, 7, 12, 0, 0);

/** An activity `off` local days from NOW (negative = past), ridden at 10:00 local. */
const ride = (off: number, tss: number) => ({
  date: new Date(2026, 9, 7 + off, 10, 0, 0).toISOString(),
  tss
});

/** An activity on a specific grid key (YYYY-MM-DD), ridden at 10:00 local. */
const rideOn = (key: string, tss: number) => {
  const [y, m, d] = key.split('-').map(Number);
  return { date: new Date(y, m - 1, d, 10, 0, 0).toISOString(), tss };
};

const weekdayOf = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};

const addDays = (key: string, n: number) => {
  const [y, m, d] = key.split('-').map(Number);
  return isoLocalDay(new Date(y, m - 1, d + n));
};

const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000);

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe('grid', () => {
  it('is 16 columns × 7 rows, column-major, Sunday-first', () => {
    const h = buildHeatmap([], NOW);
    expect(h.cells).toHaveLength(HEATMAP_WEEKS * 7);
    // row = weekday across the whole grid: cell i sits at row i % 7, Sunday = 0
    h.cells.forEach((c, i) => expect(weekdayOf(c.date)).toBe(i % 7));
  });

  it('spans exactly 16 calendar weeks ending with the current week', () => {
    const h = buildHeatmap([], NOW);
    const first = h.cells[0].date;
    const last = h.cells.at(-1)!.date;
    expect(weekdayOf(first)).toBe(0); // a Sunday opens the window
    expect(weekdayOf(last)).toBe(6); // a Saturday closes it
    expect(daysBetween(first, last)).toBe(HEATMAP_WEEKS * 7 - 1);
    expect(daysBetween(first, isoLocalDay(NOW))).toBe(NOW.getDay() + (HEATMAP_WEEKS - 1) * 7);
  });

  it('always contains today, in the last column at today’s weekday row', () => {
    // Regression: the inline version anchored the window on (today − 111d) and only
    // shifted back to a Sunday, so from Sunday onward today sat OUTSIDE the grid and
    // this week’s rides stayed invisible until Saturday.
    for (let wd = 0; wd <= 6; wd++) {
      const now = new Date(2026, 9, 4 + wd, 12); // Sunday 2026-10-04 … Saturday 2026-10-10
      const h = buildHeatmap([], now);
      const idx = h.cells.findIndex((c) => c.date === isoLocalDay(now));
      expect(idx, `weekday ${wd}`).toBeGreaterThanOrEqual(0);
      expect(Math.floor(idx / 7), `weekday ${wd}`).toBe(HEATMAP_WEEKS - 1);
      expect(idx % 7, `weekday ${wd}`).toBe(now.getDay());
    }
  });

  it('shows today’s ride in today’s cell, summing rides on the same day', () => {
    const h = buildHeatmap([ride(0, 120), ride(0, 30), ride(-1, 80)], NOW);
    const todayKey = isoLocalDay(NOW);
    expect(h.cells.find((c) => c.date === todayKey)!.tss).toBe(150);
    const y = addDays(todayKey, -1);
    expect(h.cells.find((c) => c.date === y)!.tss).toBe(80);
  });

  it('buckets a late-night ride on the day it was ridden, not the next', () => {
    const h = buildHeatmap([{ date: new Date(2026, 9, 7, 23, 30).toISOString(), tss: 45 }], NOW);
    expect(h.cells.find((c) => c.date === isoLocalDay(NOW))!.tss).toBe(45);
  });

  it('keeps the first day of the window and drops everything before it', () => {
    const firstKey = buildHeatmap([], NOW).cells[0].date;
    const before = addDays(firstKey, -1);
    const h = buildHeatmap([rideOn(firstKey, 200), rideOn(before, 300)], NOW);
    expect(h.cells[0].tss).toBe(200);
    expect(sum(h.cells.map((c) => c.tss))).toBe(200);
    expect(sum(h.weeks.map((w) => w.tss))).toBe(200); // bars lose it too
  });

  it('treats activities without a TSS score as zero load', () => {
    const h = buildHeatmap([{ date: new Date(2026, 9, 7, 10).toISOString() }], NOW);
    expect(sum(h.cells.map((c) => c.tss))).toBe(0);
    expect(h.avgTss).toBe(0);
  });

  it('maxDay is the biggest single day, floored at 1 when empty', () => {
    expect(buildHeatmap([], NOW).maxDay).toBe(1);
    expect(buildHeatmap([ride(0, 1000), ride(-1, 400)], NOW).maxDay).toBe(1000);
  });
});

describe('weekly TSS bars', () => {
  it('labels 16 weeks W1 (oldest) … W16 (current week)', () => {
    const h = buildHeatmap([], NOW);
    expect(h.weeks).toHaveLength(HEATMAP_WEEKS);
    expect(h.weeks.map((w) => w.label)).toEqual(
      Array.from({ length: HEATMAP_WEEKS }, (_, i) => `W${i + 1}`)
    );
  });

  it('puts today’s TSS in W16 and a ride 8 days ago in W15', () => {
    const h = buildHeatmap([ride(0, 240), ride(-8, 60)], NOW);
    expect(h.weeks[15].tss).toBe(240); // current calendar week: Sun 10-04 … Sat 10-10
    expect(h.weeks[14].tss).toBe(60); // Tue 09-29 belongs to the previous week
    expect(h.weeks.slice(0, 14).every((w) => w.tss === 0)).toBe(true);
  });

  it('keeps the rest of the current week in W16 (through Saturday)', () => {
    const h = buildHeatmap([ride(3, 50)], NOW); // Sat 2026-10-10
    const idx = h.cells.findIndex((c) => c.date === isoLocalDay(new Date(2026, 9, 10)));
    expect(Math.floor(idx / 7)).toBe(HEATMAP_WEEKS - 1);
    expect(h.weeks[15].tss).toBe(50);
  });

  it('never disagrees with the grid: every bar equals its column’s total', () => {
    const firstKey = buildHeatmap([], NOW).cells[0].date;
    const h = buildHeatmap(
      [rideOn(firstKey, 100), ride(-8, 60), ride(0, 240), ride(3, 80), ride(-50, 15)],
      NOW
    );
    for (let w = 0; w < HEATMAP_WEEKS; w++) {
      const column = sum(h.cells.slice(w * 7, w * 7 + 7).map((c) => c.tss));
      expect(h.weeks[w].tss).toBe(column);
    }
    expect(sum(h.weeks.map((w) => w.tss))).toBe(sum(h.cells.map((c) => c.tss)));
  });

  it('avgTss averages only the weeks that carried load', () => {
    const firstKey = buildHeatmap([], NOW).cells[0].date;
    const h = buildHeatmap([rideOn(firstKey, 100), ride(0, 250)], NOW);
    expect(h.avgTss).toBe(175); // (100 + 250) / 2 — the 14 empty weeks don’t drag it down
  });

  it('books min/max across the window, flooring maxWeek at 1', () => {
    const empty = buildHeatmap([], NOW);
    expect(empty.minWeek).toBe(0);
    expect(empty.maxWeek).toBe(1);
    expect(empty.avgTss).toBe(0);

    const firstKey = empty.cells[0].date;
    const h = buildHeatmap([rideOn(firstKey, 100), ride(0, 400)], NOW);
    expect(h.minWeek).toBe(0); // 14 weeks still empty
    expect(h.maxWeek).toBe(400);
  });
});

describe('heatLevel', () => {
  it('is 0 for rest days and anything ≤ 0', () => {
    expect(heatLevel(0, 400)).toBe(0);
    expect(heatLevel(-3, 400)).toBe(0);
  });

  it('ramps at 25 / 50 / 75% of the grid’s biggest day', () => {
    expect(heatLevel(99, 400)).toBe(1);
    expect(heatLevel(100, 400)).toBe(2);
    expect(heatLevel(199, 400)).toBe(2);
    expect(heatLevel(200, 400)).toBe(3);
    expect(heatLevel(299, 400)).toBe(3);
    expect(heatLevel(300, 400)).toBe(4);
    expect(heatLevel(400, 400)).toBe(4);
  });

  it('gives a solo-ride history full heat', () => {
    const h = buildHeatmap([ride(0, 60)], NOW);
    expect(heatLevel(60, h.maxDay)).toBe(4);
  });
});
