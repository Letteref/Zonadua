import { describe, it, expect } from 'vitest';
import { correctForWind, headwindKph, peakHeadwind, compass } from '../wind';
import { parseHourlyWind, forecastUrl } from '../../infra/weather/openmeteo';

/**
 * The sign of a headwind is the whole product of this module. A wind that arrives as a
 * tailwind is worse than no forecast, because it makes a slow day look fast — the rider
 * sets off underpacked into a headwind and finds out at the first climb.
 */
describe('headwind geometry', () => {
  it('is a pure headwind when the wind comes from the direction of travel', () => {
    expect(headwindKph({ wind: { speedKph: 30, fromDeg: 90 }, travelDeg: 90 })).toBe(30);
  });

  it('is a pure tailwind from directly behind', () => {
    expect(headwindKph({ wind: { speedKph: 30, fromDeg: 270 }, travelDeg: 90 })).toBe(-30);
  });

  it('is a crosswind, neither helping nor resisting, from either side', () => {
    expect(headwindKph({ wind: { speedKph: 30, fromDeg: 0 }, travelDeg: 90 })).toBe(0);
    expect(headwindKph({ wind: { speedKph: 30, fromDeg: 180 }, travelDeg: 90 })).toBe(0);
  });

  it('wraps the 0/360 seam without flipping sign', () => {
    // northbound rider, wind from 350 — just off the bow, so still a headwind
    expect(headwindKph({ wind: { speedKph: 20, fromDeg: 350 }, travelDeg: 5 })).toBeGreaterThan(0);
    // same wind, rider heading the other way — must not come out negative by accident
    expect(headwindKph({ wind: { speedKph: 20, fromDeg: 350 }, travelDeg: 175 })).toBeLessThan(0);
  });

  it('treats no forecast as still air, never as a tailwind', () => {
    expect(headwindKph({ wind: null, travelDeg: 90 })).toBe(0);
  });

  it('refuses a malformed wind rather than propagating NaN', () => {
    expect(headwindKph({ wind: { speedKph: NaN, fromDeg: 90 }, travelDeg: 90 })).toBe(0);
    expect(headwindKph({ wind: { speedKph: 20, fromDeg: NaN }, travelDeg: 90 })).toBe(0);
    expect(headwindKph({ wind: { speedKph: 20, fromDeg: 90 }, travelDeg: NaN })).toBe(0);
  });

  it('reports the worst hour of a day, not the average', () => {
    const hours = [
      { speedKph: 8, fromDeg: 90 },
      { speedKph: 35, fromDeg: 90 },
      { speedKph: 10, fromDeg: 90 }
    ];
    const peak = peakHeadwind(hours, 90);
    expect(peak).toEqual({ kph: 35, hourIndex: 1 });
  });

  it('labels a bearing without needing it to be exact', () => {
    expect(compass(0)).toBe('N');
    expect(compass(90)).toBe('E');
    expect(compass(359)).toBe('N');
  });
});

/**
 * The two-pass correction (ROADMAP M5 "2-iterasi koreksi").
 *
 * The failure it exists to prevent: reading the 09:00 gust for a rider who reaches the
 * exposed climb at 14:00. The solver is an arithmetic double here — real physics is
 * tested elsewhere — because what is under test is *which hour gets read*, not the watts.
 */
describe('two-iteration wind correction', () => {
  /** arrival hour falls 1h per 10 km/h of headwind, and solve returns that hour */
  const solve = (kph: number) => ({ hours: 9 + kph / 10 });

  it('reads the wind for the hour the rider actually arrives', () => {
    const result = correctForWind({
      solve,
      hourAt: (p) => p.hours,
      windAt: (h) => (h === 9 ? { speedKph: 10, fromDeg: 90 } : { speedKph: 40, fromDeg: 90 }),
      travelDeg: 90
    });

    // still-air arrival is 09:00, so a 10 km/h wind applies, not the 40 km/h of 14:00
    expect(result.forecastUsed).toBe(true);
    expect(result.headwindKph).toBe(10);
    expect(result.plan.hours).toBeCloseTo(10, 5);
  });

  it('reports the drift the wind introduced, so the caller can judge it', () => {
    const result = correctForWind({
      solve,
      hourAt: (p) => p.hours,
      windAt: () => ({ speedKph: 20, fromDeg: 90 }),
      travelDeg: 90
    });

    expect(result.driftHours).toBeCloseTo(2, 5); // arrived at 09:00, pushed to 11:00
    expect(result.stable).toBe(false); // 2h exceeds the default 0.5h tolerance
  });

  it('calls a small shift stable', () => {
    const result = correctForWind({
      solve,
      hourAt: (p) => p.hours,
      windAt: () => ({ speedKph: 2, fromDeg: 90 }),
      travelDeg: 90
    });

    expect(result.stable).toBe(true);
  });

  it('hands back the windless plan and says why when there is no forecast', () => {
    const result = correctForWind({
      solve,
      hourAt: (p) => p.hours,
      windAt: () => null,
      travelDeg: 90
    });

    expect(result.forecastUsed).toBe(false);
    expect(result.headwindKph).toBe(0);
    expect(result.plan.hours).toBe(9); // untouched still-air plan
  });

  it('uses the rider\'s direction, so a crosswind is not applied as a headwind', () => {
    const result = correctForWind({
      solve,
      hourAt: (p) => p.hours,
      windAt: () => ({ speedKph: 40, fromDeg: 0 }), // wind from the north
      travelDeg: 90 // rider heading east
    });

    expect(result.headwindKph).toBe(0);
    expect(result.plan.hours).toBe(9);
  });
});

describe('Open-Meteo parsing', () => {
  it('reads a well-formed hourly series', () => {
    const parsed = parseHourlyWind({
      hourly: { wind_speed_10m: [10, 20, 30], wind_direction_10m: [90, 180, 270] }
    });

    expect(parsed).toEqual([
      { speedKph: 10, fromDeg: 90 },
      { speedKph: 20, fromDeg: 180 },
      { speedKph: 30, fromDeg: 270 }
    ]);
  });

  it('refuses a partial series rather than reporting the calm hours as the whole day', () => {
    // a hole mid-day would read as "calm" and understate the headwind around it
    expect(parseHourlyWind({ hourly: { wind_speed_10m: [10, null, 30], wind_direction_10m: [90, 0, 270] } })).toBeNull();
  });

  it('refuses mismatched lengths and empty input', () => {
    expect(parseHourlyWind({ hourly: { wind_speed_10m: [10, 20], wind_direction_10m: [90] } })).toBeNull();
    expect(parseHourlyWind({ hourly: { wind_speed_10m: [], wind_direction_10m: [] } })).toBeNull();
    expect(parseHourlyWind(null)).toBeNull();
    expect(parseHourlyWind({})).toBeNull();
  });

  it('normalises a direction of 360 to north', () => {
    expect(parseHourlyWind({ hourly: { wind_speed_10m: [5], wind_direction_10m: [360] } })).toEqual([
      { speedKph: 5, fromDeg: 0 }
    ]);
  });

  it('asks for hourly wind in km/h and UTC', () => {
    const url = forecastUrl({ latitude: -2.95, longitude: 104.75, startDate: '2026-10-04', endDate: '2026-10-05' });

    expect(url).toContain('api.open-meteo.com');
    expect(url).toContain('wind_speed_10m');
    expect(url).toContain('wind_speed_unit=kmh');
    expect(url).toContain('timezone=UTC');
    // no key: weather must not become a subscription
    expect(url).not.toMatch(/key=/i);
  });
});
