import { describe, expect, it } from 'vitest';
import {
  buildDeparturePlan,
  epochMinutesOfRouteLocal,
  historicalSpeedKph,
  scoreDeparture,
  type DepartureInput,
  type RideForecastHour
} from '../departure';

/** Hourly fixture: each spec entry is one hour; defaults are dry, mild, still air. */
function hours(
  spec: Array<{
    tempC?: number;
    prob?: number;
    mm?: number;
    windKph?: number;
    fromDeg?: number;
  }>,
  startIso = '2026-10-18T00:00'
): RideForecastHour[] {
  const [h, m] = startIso.split('T')[1].split(':').map(Number);
  return spec.map((s, i) => {
    const total = h * 60 + m + i * 60;
    const pad = (n: number): string => String(n).padStart(2, '0');
    const day = 18 + Math.floor(total / 1440);
    const clock = `${pad(Math.floor((total % 1440) / 60))}:${pad(total % 60)}`;
    return {
      time: `2026-10-${pad(day)}T${clock}`,
      tempC: s.tempC ?? 20,
      precipProbPct: s.prob ?? 0,
      precipMm: s.mm ?? 0,
      wind: { speedKph: s.windKph ?? 0, fromDeg: s.fromDeg ?? 0 }
    };
  });
}

const START_EPOCH = epochMinutesOfRouteLocal('2026-10-18T00:00', 0)!;

function input(over: Partial<DepartureInput> = {}): DepartureInput {
  return {
    forecast: hours(Array.from({ length: 24 }, () => ({}))),
    utcOffsetSeconds: 0,
    // decision moment: 18 minutes before the first forecast hour
    nowEpochMin: START_EPOCH - 18,
    distanceKm: 60,
    speed: { kph: 30, rides: 12 },
    bearingDeg: null,
    ...over
  };
}

describe('historicalSpeedKph', () => {
  it('refuses rather than guessing when there is no history', () => {
    expect(historicalSpeedKph([])).toBeNull();
  });

  it('excludes errand-sized rides', () => {
    const s = historicalSpeedKph([
      { distanceKm: 2, movingSec: 600 },
      { distanceKm: 20, movingSec: 300 } // 5 min — a spin around the block
    ]);
    expect(s).toBeNull();
  });

  it('is distance-weighted, not an average of per-ride averages', () => {
    // 120 km in 4 h and 20 km in 1 h: (140/5)=28.0, not mean(30, 20)=25
    const s = historicalSpeedKph([
      { distanceKm: 20, movingSec: 3600 },
      { distanceKm: 120, movingSec: 4 * 3600 }
    ]);
    expect(s).toEqual({ kph: 28, rides: 2 });
  });

  it('keeps only the newest slice', () => {
    const many = Array.from({ length: 20 }, () => ({ distanceKm: 30, movingSec: 3600 }));
    const s = historicalSpeedKph(many);
    expect(s?.rides).toBe(12);
  });
});

describe('epochMinutesOfRouteLocal', () => {
  it('reads the route-local wall clock against the forecast offset', () => {
    // 06:00 at UTC+7 is 23:00 UTC the previous day
    expect(epochMinutesOfRouteLocal('2026-10-18T06:00', 7 * 3600)).toBe(
      epochMinutesOfRouteLocal('2026-10-17T23:00', 0)
    );
  });

  it('refuses a malformed hour string', () => {
    expect(epochMinutesOfRouteLocal('2026-10-18 06:00', 0)).toBeNull();
  });
});

describe('scoreDeparture', () => {
  it('adds up the documented weights', () => {
    const s = scoreDeparture({
      hourIndex: 0,
      startEpochMin: 0,
      startClock: '06:00',
      finishClock: '09:00',
      finishesNextDay: false,
      durationH: 3,
      tempC: 32,
      rainPct: 90,
      precipMm: 1.5,
      headwindKph: 10
    });
    // 90*0.6 + 1.5*4 + (32-30)*3 + 10*1.2 = 54 + 6 + 6 + 12
    expect(s).toBe(78);
  });

  it('does not refund a tailwind', () => {
    const base = {
      hourIndex: 0,
      startEpochMin: 0,
      startClock: '06:00',
      finishClock: '08:00',
      finishesNextDay: false,
      durationH: 2,
      tempC: 20,
      rainPct: 0,
      precipMm: 0
    };
    expect(scoreDeparture({ ...base, headwindKph: -15 })).toBe(0);
  });
});

describe('buildDeparturePlan', () => {
  it('refuses without a historical speed — no invented ETA', () => {
    expect(buildDeparturePlan(input({ speed: null }))).toBeNull();
  });

  it('refuses an empty forecast', () => {
    expect(buildDeparturePlan(input({ forecast: [] }))).toBeNull();
  });

  it('offers hourly candidates after the lead time, soonest first', () => {
    const plan = buildDeparturePlan(input())!;
    // decided 18 min before 00:00, 30 min lead → first candidate is the 01:00 hour
    expect(plan.options[0].startClock).toBe('01:00');
    expect(plan.options.map((o) => o.startClock)).toEqual(
      plan.options.map((_, i) => `${String(i + 1).padStart(2, '0')}:00`)
    );
  });

  it('still air: 60 km at 30 km/h is a 2 h ride', () => {
    const plan = buildDeparturePlan(input())!;
    expect(plan.options[0].durationH).toBe(2);
    expect(plan.options[0].finishClock).toBe('03:00');
  });

  it('carries the roll-out as a true instant, not just a wall clock', () => {
    const plan = buildDeparturePlan(input())!;
    // first candidate is the 01:00 forecast hour of 2026-10-18
    expect(plan.options[0].startEpochMin).toBe(START_EPOCH + 60);
    expect(new Date(plan.options[0].startEpochMin * 60000).toISOString()).toContain('T01:00:00.000Z');
  });

  it('labels pills with the route\'s wall clock, never the UTC hour', () => {
    // Regression: formatting the raw instant showed UTC — a Jakarta (UTC+7) forecast
    // rendered every pill 7 h early, and tapping "14:00" meant a 21:00 roll-out.
    const offset = 25200; // Asia/Jakarta, what Open-Meteo actually answers with
    const plan = buildDeparturePlan(
      input({
        utcOffsetSeconds: offset,
        nowEpochMin: epochMinutesOfRouteLocal('2026-10-18T00:00', offset)! - 18,
        forecast: hours(Array.from({ length: 6 }, () => ({})))
      })
    )!;
    const first = plan.options[0];
    // the wall clock survives the epoch round-trip …
    expect(first.startClock).toBe('01:00');
    expect(first.finishClock).toBe('03:00');
    // … while the instant behind it is genuinely 7 h earlier in UTC
    expect(new Date(first.startEpochMin * 60000).toISOString()).toBe('2026-10-17T18:00:00.000Z');
  });

  it('the dry hour beats the rainy one', () => {
    const forecast = hours([
      {}, // 00:00
      {}, // 01:00
      { prob: 90, mm: 2 }, // 02:00 — soaking
      {}, // 03:00 — dry
      {},
      {}
    ]);
    const plan = buildDeparturePlan(input({ forecast, horizonHours: 4 }))!;
    const best = plan.options[plan.bestIndex!];
    expect(best.startClock).toBe('03:00');
    expect(plan.options.find((o) => o.startClock === '02:00')!.score).toBeGreaterThan(best.score);
  });

  it('a headwind lengthens the ride; a tailwind shortens it', () => {
    // bearing due east
    const head = buildDeparturePlan(
      input({ bearingDeg: 90, forecast: hours(Array.from({ length: 8 }, () => ({ windKph: 20, fromDeg: 90 }))) })
    )!;
    const tail = buildDeparturePlan(
      input({ bearingDeg: 90, forecast: hours(Array.from({ length: 8 }, () => ({ windKph: 20, fromDeg: 270 }))) })
    )!;
    // 30 km/h minus 20 on the nose → 10 km/h → 6 h; with it behind → 50 km/h → 1.2 h
    expect(head.options[0].durationH).toBe(6);
    expect(head.options[0].headwindKph).toBe(20);
    expect(tail.options[0].durationH).toBe(1.2);
    expect(tail.options[0].headwindKph).toBe(-20);
  });

  it('says so when no bearing means no wind claim', () => {
    const plan = buildDeparturePlan(
      input({ bearingDeg: null, forecast: hours([{ windKph: 35, fromDeg: 90 }, {}, {}, {}]) })
    )!;
    expect(plan.options[0].headwindKph).toBe(0);
    expect(plan.evidence).toContain('wind not applied (no track bearing)');
  });

  it('drops candidates whose ride runs past the end of the forecast', () => {
    // 60 km at 15 km/h = 4 h; a 24 h forecast leaves no room after 20:00
    const plan = buildDeparturePlan(input({ speed: { kph: 15, rides: 5 } }))!;
    expect(plan.options.at(-1)!.startClock).toBe('20:00');
  });

  it('flags a finish that crosses midnight', () => {
    const forecast = hours(Array.from({ length: 26 }, () => ({})));
    const plan = buildDeparturePlan(
      input({ forecast, nowEpochMin: START_EPOCH + 22 * 60 + 10, horizonHours: 2 })
    )!;
    const best = plan.options[plan.bestIndex!];
    expect(best.startClock).toBe('23:00');
    expect(best.finishClock).toBe('01:00');
    expect(best.finishesNextDay).toBe(true);
  });

  it('restates the measured figures in the evidence line', () => {
    const plan = buildDeparturePlan(input({ distanceKm: 96.2, speed: { kph: 27.4, rides: 9 } }))!;
    expect(plan.evidence).toContain('ETA from your last 9 rides');
    expect(plan.evidence).toContain('27.4 km/h historical');
    expect(plan.evidence).toContain('96.2 km route');
    expect(plan.evidence).toContain('Open-Meteo hourly');
  });

  it('reports the worst rain met anywhere on the ride, not at the start', () => {
    // dry at 01:00 but soaked at 02:00 on a 2 h ride
    const forecast = hours([
      {},
      { prob: 85, mm: 3 },
      {},
      {},
      {}
    ]);
    const plan = buildDeparturePlan(input({ forecast, horizonHours: 2 }))!;
    const first = plan.options[0]; // 01:00 → covers 01:00 and 02:00
    expect(first.rainPct).toBe(85);
    expect(first.precipMm).toBe(3);
  });
});
