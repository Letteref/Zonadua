import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POWER_ZONES,
  DEFAULT_ZONE_STOPS,
  ZONE_TEMPLATES,
  bandsFromStops,
  stopsFromBands,
  validateStops,
  zoneDistribution
} from '../zones';

describe('zone templates', () => {
  it('offers the granular model plus two coarser ones', () => {
    expect(ZONE_TEMPLATES.map((t) => t.id)).toEqual(['coggan8', 'coggan5', 'coggan3']);
  });

  it('keeps every template valid', () => {
    for (const t of ZONE_TEMPLATES) {
      expect(validateStops(t.stops), `${t.id} must validate`).toEqual({ ok: true });
    }
  });

  it('starts every template at 0% so no power is uncounted', () => {
    for (const t of ZONE_TEMPLATES) {
      const bands = bandsFromStops(t.stops);
      expect(bands[0].minPct).toBe(0);
    }
  });

  it('produces contiguous bands with no gap and no overlap', () => {
    for (const t of ZONE_TEMPLATES) {
      const bands = bandsFromStops(t.stops);
      for (let i = 0; i < bands.length - 1; i++) {
        expect(bands[i].maxPct).toBe(bands[i + 1].minPct);
      }
      expect(bands.at(-1)!.maxPct).toBe(Infinity);
    }
  });

  it('attributes every sample to exactly one zone for every template', () => {
    for (const t of ZONE_TEMPLATES) {
      const bands = bandsFromStops(t.stops);
      const probe = Array.from({ length: 400 }, (_, i) => i * 2); // 0…798 W
      const d = zoneDistribution(probe, 250, 1, bands);
      // seconds are exact — no rounding — so this is the real "nothing is dropped" check
      expect(d.zones.reduce((a, z) => a + z.sec, 0), `${t.id} must account for all time`).toBe(400);
      // percentages are rounded to 0.1% per zone, so they can drift by a few tenths
      expect(d.zones.reduce((a, z) => a + z.pct, 0)).toBeGreaterThan(99);
      expect(d.zones.reduce((a, z) => a + z.pct, 0)).toBeLessThan(101);
    }
  });
});

describe('bandsFromStops', () => {
  it('fills each upper bound from the next stop', () => {
    expect(
      bandsFromStops([
        { key: 'A', name: 'Low', minPct: 0 },
        { key: 'B', name: 'High', minPct: 60 }
      ])
    ).toEqual([
      { key: 'A', name: 'Low', minPct: 0, maxPct: 60 },
      { key: 'B', name: 'High', minPct: 60, maxPct: Infinity }
    ]);
  });

  it('sorts stops that arrive out of order', () => {
    const bands = bandsFromStops([
      { key: 'B', name: 'High', minPct: 75 },
      { key: 'A', name: 'Low', minPct: 0 }
    ]);
    expect(bands.map((b) => b.minPct)).toEqual([0, 75]);
  });

  it('rebuilds the default bands from the default stops', () => {
    expect(bandsFromStops(DEFAULT_ZONE_STOPS)).toEqual([...DEFAULT_POWER_ZONES]);
  });
});

describe('stopsFromBands', () => {
  it('round-trips a stored zone record', () => {
    const stored = DEFAULT_POWER_ZONES.map((b) => ({ name: b.name, min: b.minPct, max: b.maxPct }));
    const stops = stopsFromBands(stored);
    expect(bandsFromStops(stops)).toEqual([...DEFAULT_POWER_ZONES]);
  });

  it('treats a missing min as zero rather than NaN', () => {
    expect(stopsFromBands([{ name: 'Easy' }])).toEqual([{ key: 'Z0', name: 'Easy', minPct: 0 }]);
  });
});

describe('validateStops', () => {
  it('accepts an ascending list starting at zero', () => {
    expect(
      validateStops([
        { key: 'A', name: 'Easy', minPct: 0 },
        { key: 'B', name: 'Hard', minPct: 90 }
      ])
    ).toEqual({ ok: true });
  });

  it('rejects a list that does not start at 0%', () => {
    const r = validateStops([{ key: 'A', name: 'Only', minPct: 40 }]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/start at 0/);
  });

  it('rejects duplicate boundaries', () => {
    const r = validateStops([
      { key: 'A', name: 'Easy', minPct: 0 },
      { key: 'B', name: 'Hard', minPct: 0 }
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/share the 0%/);
  });

  it('rejects an empty list, blank names, negatives and huge lists', () => {
    expect(validateStops([]).ok).toBe(false);
    expect(validateStops([{ key: 'A', name: '  ', minPct: 0 }]).ok).toBe(false);
    expect(validateStops([{ key: 'A', name: 'A', minPct: -5 }]).ok).toBe(false);
    const many = Array.from({ length: 11 }, (_, i) => ({ key: `Z${i}`, name: `Z${i}`, minPct: i }));
    expect(validateStops(many).ok).toBe(false);
  });

  it('does not care about the order rows are edited in', () => {
    const r = validateStops([
      { key: 'B', name: 'Hard', minPct: 90 },
      { key: 'A', name: 'Easy', minPct: 0 }
    ]);
    expect(r).toEqual({ ok: true });
  });
});