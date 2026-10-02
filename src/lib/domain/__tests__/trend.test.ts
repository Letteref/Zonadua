import { describe, expect, it } from 'vitest';
import { buildTrend } from '../trend';

const NOW = new Date('2026-10-02T00:00:00.000Z');
const weights = [
  { date: '2026-07-04', kg: 69.8 },
  { date: '2026-07-25', kg: 69.3 },
  { date: '2026-08-15', kg: 68.9 },
  { date: '2026-09-05', kg: 68.5 }
];
const ftps = [
  { date: '2026-05-05', ftp: 266 },
  { date: '2026-08-03', ftp: 272 },
  { date: '2026-09-18', ftp: 275 }
];

describe('buildTrend', () => {
  it('puts weight logs on the timeline as sparse points', () => {
    const t = buildTrend(weights, ftps, NOW);
    expect(t.weight).toHaveLength(4);
    // the axis starts at the earliest record of either series (5 May FTP test),
    // so the first weigh-in lands 60 days in, not at zero
    expect(t.weight[0]).toEqual({ t: 60, kg: 69.8 });
    expect(t.weight.at(-1)).toEqual({ t: 123, kg: 68.5 });
  });

  it('never invents a weight between weigh-ins', () => {
    const t = buildTrend(weights, ftps, NOW);
    // four weigh-ins → exactly four weight points, no interpolation
    expect(t.weight.length).toBe(weights.length);
  });

  it('carries FTP forward as a step function', () => {
    const t = buildTrend(weights, ftps, NOW);
    // axis starts on the first FTP test, so that row is t = 0
    expect(t.ftp[0]).toEqual({ t: 0, w: 266 });
    // the last point before the 18 Sep test still carries the previous value
    const sepIndex = t.points.findIndex((p) => p.date === '2026-09-18');
    expect(t.ftp[sepIndex - 1].w).toBe(272);
    expect(t.points[sepIndex].ftp).toBe(275);
    // and today's point carries the newest value
    expect(t.ftp.at(-1)).toEqual({ t: 150, w: 275 });
  });

  it('computes the weekly weight slope in kg', () => {
    const t = buildTrend(weights, ftps, NOW);
    // 68.5 − 69.8 = −1.3 kg over 9 weeks
    expect(t.kgPerWeek).toBeCloseTo(-0.14, 2);
  });

  it('reports the total FTP change across the series', () => {
    expect(buildTrend(weights, ftps, NOW).ftpDelta).toBe(9);
  });

  it('handles weight-only and FTP-only series', () => {
    const weightOnly = buildTrend(weights, [], NOW);
    expect(weightOnly.ftp).toHaveLength(0);
    expect(weightOnly.kgPerWeek).toBeCloseTo(-0.14, 2);
    expect(weightOnly.ftpDelta).toBe(0);

    const ftpOnly = buildTrend([], ftps, NOW);
    expect(ftpOnly.weight).toHaveLength(0);
    expect(ftpOnly.ftpDelta).toBe(9);
    expect(ftpOnly.kgPerWeek).toBe(0);
  });

  it('returns an empty series when there is nothing logged', () => {
    const t = buildTrend([], [], NOW);
    expect(t.points).toEqual([]);
    expect(t.weight).toEqual([]);
    expect(t.ftp).toEqual([]);
  });

  it('is order-independent', () => {
    const a = buildTrend(weights, ftps, NOW);
    const b = buildTrend([...weights].reverse(), [...ftps].reverse(), NOW);
    expect(a.weight).toEqual(b.weight);
    expect(a.ftp).toEqual(b.ftp);
  });

  it('tolerates full ISO datetimes in weight dates', () => {
    const t = buildTrend([{ date: '2026-09-01T06:30:00Z', kg: 68 }], [], NOW);
    expect(t.weight[0]).toEqual({ t: 0, kg: 68 });
  });

  it('needs two weigh-ins before reporting a slope', () => {
    expect(buildTrend([{ date: '2026-09-01', kg: 68 }], [], NOW).kgPerWeek).toBe(0);
  });
});