import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POWER_ZONES,
  fmtDuration,
  highIntensityShare,
  intensityZones,
  zoneDistribution,
  zoneOfPower
} from '../zones';

const FTP = 250;
const flat = (watts: number, samples: number): number[] => new Array(samples).fill(watts);

describe('zoneOfPower', () => {
  it('maps power to Coggan bands by % of FTP', () => {
    expect(zoneOfPower(100, FTP)?.key).toBe('Z0'); // 40%
    expect(zoneOfPower(165, FTP)?.key).toBe('Z1'); // 66%
    expect(zoneOfPower(212, FTP)?.key).toBe('Z2'); // 85%
    expect(zoneOfPower(245, FTP)?.key).toBe('Z3'); // 98%
    expect(zoneOfPower(280, FTP)?.key).toBe('Z4'); // 112%
    expect(zoneOfPower(330, FTP)?.key).toBe('Z5'); // 132%
    expect(zoneOfPower(410, FTP)?.key).toBe('Z6'); // 164%
    expect(zoneOfPower(520, FTP)?.key).toBe('Z7'); // 208%
  });

  it('treats band edges as inclusive at the bottom', () => {
    expect(zoneOfPower(137.5, FTP)?.key).toBe('Z1'); // exactly 55%
    expect(zoneOfPower(137.49, FTP)?.key).toBe('Z0');
  });

  it('returns undefined without a usable FTP', () => {
    expect(zoneOfPower(200, 0)).toBeUndefined();
    expect(zoneOfPower(200, -10)).toBeUndefined();
    expect(zoneOfPower(Number.NaN, FTP)).toBeUndefined();
  });

  it('respects custom bands', () => {
    const custom = [{ key: 'LOW', name: 'Easy', minPct: 0, maxPct: 90 }];
    expect(zoneOfPower(200, FTP, custom)?.key).toBe('LOW');
    expect(zoneOfPower(240, FTP, custom)).toBeUndefined();
  });
});

describe('zoneDistribution', () => {
  it('splits time across bands by sample count', () => {
    // 20 samples at 165 W (Z1) and 80 at 280 W (Z4), 1 s apart
    const trace = [...flat(165, 20), ...flat(280, 80)];
    const d = zoneDistribution(trace, FTP);
    expect(d.totalSec).toBe(100);
    const z1 = d.zones.find((z) => z.band.key === 'Z1')!;
    const z4 = d.zones.find((z) => z.band.key === 'Z4')!;
    expect(z1.sec).toBe(20);
    expect(z1.pct).toBe(20);
    expect(z4.sec).toBe(80);
    expect(z4.pct).toBe(80);
  });

  it('always returns every band, even with no time in it', () => {
    const d = zoneDistribution(flat(200, 10), FTP);
    expect(d.zones).toHaveLength(DEFAULT_POWER_ZONES.length);
    expect(d.zones.reduce((a, z) => a + z.pct, 0)).toBeCloseTo(100, 5);
  });

  it('scales to the sampling interval', () => {
    // 200 W against 250 W FTP is 80% → Z2
    const d = zoneDistribution(flat(200, 60), FTP, 5);
    expect(d.totalSec).toBe(300);
    expect(d.zones.find((z) => z.band.key === 'Z2')!.sec).toBe(300);
  });

  it('reports mean power across the trace', () => {
    expect(zoneDistribution([...flat(200, 3), ...flat(400, 1)], FTP).avgPower).toBe(250);
  });

  it('handles an empty trace without dividing by zero', () => {
    const d = zoneDistribution([], FTP);
    expect(d.totalSec).toBe(0);
    expect(d.avgPower).toBe(0);
    expect(d.zones.every((z) => z.pct === 0)).toBe(true);
  });

  it('is safe when FTP is unknown: no time is attributed', () => {
    const d = zoneDistribution(flat(200, 100), 0);
    expect(d.zones.every((z) => z.sec === 0)).toBe(true);
  });

  it('converts band bounds to watts for the current FTP', () => {
    const d = zoneDistribution(flat(200, 10), FTP);
    expect(d.zones.find((z) => z.band.key === 'Z1')!.minWatts).toBe(138); // 55% of 250
  });

  it('buckets zero and negative samples into recovery', () => {
    const d = zoneDistribution([...flat(0, 5), ...flat(-100, 5)], FTP);
    expect(d.zones.find((z) => z.band.key === 'Z0')!.sec).toBe(10);
  });
});

describe('intensity helpers', () => {
  it('selects Sweet spot and above', () => {
    // 100 W = 40% (Z0), 250 W = 100% (Z3), 300 W = 120% (Z5)
    const d = zoneDistribution([...flat(100, 10), ...flat(250, 10), ...flat(300, 10)], FTP);
    const high = intensityZones(d);
    expect(high.map((z) => z.band.key)).toEqual(['Z3', 'Z4', 'Z5', 'Z6', 'Z7']);
    expect(highIntensityShare(d)).toBe(66.6);
  });

  it('reports zero for an all-easy ride', () => {
    expect(highIntensityShare(zoneDistribution(flat(150, 60), FTP))).toBe(0);
  });
});

describe('fmtDuration', () => {
  it('falls back to seconds below a minute', () => {
    expect(fmtDuration(11)).toBe('11s');
    expect(fmtDuration(59)).toBe('59s');
  });

  it('formats minutes under an hour', () => {
    expect(fmtDuration(45 * 60)).toBe('45m');
  });

  it('is safe with nonsense input', () => {
    expect(fmtDuration(-5)).toBe('—');
    expect(fmtDuration(Number.NaN)).toBe('—');
  });

  it('formats hours and minutes', () => {
    expect(fmtDuration(5400)).toBe('1h 30m');
  });

  it('carries a 59.7-minute ride into the next hour instead of printing 60m', () => {
    expect(fmtDuration(3582)).toBe('1h 00m');
  });
});