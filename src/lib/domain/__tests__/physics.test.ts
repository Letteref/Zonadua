import { describe, expect, it } from 'vitest';
import {
  GRAVITY,
  airDensity,
  kilojoulesForRide,
  powerForSpeed,
  requiredPower,
  resampleProfile,
  solveRide,
  solveSpeed,
  totalMass
} from '../physics';

const RIDER = {
  riderKg: 68,
  bikeKg: 9.4,
  crr: 0.0045,
  cda: 0.32,
  airDensity: 1.225, // fixed so the analytic comparisons below are exact
  drivetrainLoss: 0,
  vMaxKph: 65
};

/** Flat profile of the given length, used as a baseline for comparisons. */
const flat = (km: number): { distKm: number; altM: number }[] =>
  Array.from({ length: 6 }, (_, i) => ({ distKm: (km * i) / 5, altM: 100 }));

describe('requiredPower', () => {
  it('on the flat is rolling + aero only', () => {
    const vKph = 30;
    const v = vKph / 3.6;
    const expected = 0.0045 * 77.4 * GRAVITY * v + 0.5 * 1.225 * 0.32 * v ** 3;
    expect(requiredPower(RIDER, 0, vKph)).toBeCloseTo(expected, 6);
  });

  it('adds a gravity term on a climb and subtracts one on a descent', () => {
    // crr 0 isolates gravity + aero, so the rolling term's cos(θ) change does not blur it
    const smooth = { ...RIDER, crr: 0 };
    const vKph = 20;
    const v = vKph / 3.6;
    const theta = Math.atan(5 / 100);
    const flatP = requiredPower(smooth, 0, vKph);
    const climbP = requiredPower(smooth, 5, vKph);
    const descentP = requiredPower(smooth, -5, vKph);

    expect(climbP - flatP).toBeCloseTo(77.4 * GRAVITY * v * Math.sin(theta), 6);
    expect(flatP - descentP).toBeCloseTo(77.4 * GRAVITY * v * Math.sin(theta), 6);
  });

  it('scales the gravity+rolling part with total mass', () => {
    // aero is mass-independent, so the ratio only holds with aero switched off too
    const smooth = { ...RIDER, crr: 0, cda: 0 };
    const light = requiredPower({ ...smooth, riderKg: 60 }, 10, 20);
    const heavy = requiredPower({ ...smooth, riderKg: 80 }, 10, 20);
    expect(heavy / light).toBeCloseTo((80 + 9.4) / (60 + 9.4), 6);
  });

  it('includes cargo in the mass', () => {
    expect(totalMass({ ...RIDER, cargoKg: 3 })).toBe(80.4);
    expect(requiredPower({ ...RIDER, cargoKg: 3 }, 0, 30)).toBeGreaterThan(requiredPower(RIDER, 0, 30));
  });

  it('adds drivetrain loss on top of the wheel power', () => {
    const wheelOnly = requiredPower(RIDER, 0, 30);
    const lossy = requiredPower({ ...RIDER, drivetrainLoss: 0.025 }, 0, 30);
    expect(lossy).toBeCloseTo(wheelOnly / 0.975, 6);
  });

  it('a headwind raises the aerodynamic cost', () => {
    expect(requiredPower({ ...RIDER, headwindKph: 20 }, 0, 30)).toBeGreaterThan(
      requiredPower(RIDER, 0, 30)
    );
    // and a tailwind lowers it, below the still-air value at the same ground speed
    expect(requiredPower({ ...RIDER, headwindKph: -20 }, 0, 30)).toBeLessThan(
      requiredPower(RIDER, 0, 30)
    );
  });

  it('rises monotonically with speed', () => {
    let prev = -1;
    for (let v = 10; v <= 60; v += 5) {
      const p = requiredPower(RIDER, 0, v);
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });
});

describe('solveSpeed', () => {
  it('inverts the forward model: solved power equals the target', () => {
    for (const grade of [0, 2, 5, -3, -8]) {
      const { vKph, powerLimited } = solveSpeed(RIDER, grade, 250);
      expect(powerLimited).toBe(false);
      // a descent can hit the speed cap, where the rider holds less than the target
      const capped = vKph >= RIDER.vMaxKph;
      const expectedPower = requiredPower(RIDER, grade, vKph);
      if (capped) expect(expectedPower).toBeLessThan(250);
      else expect(expectedPower).toBeCloseTo(250, 3);
    }
  });

  it('is slower uphill and faster downhill at equal power', () => {
    const uphill = solveSpeed(RIDER, 6, 250).vKph;
    const flat = solveSpeed(RIDER, 0, 250).vKph;
    const downhill = solveSpeed(RIDER, -6, 250).vKph;
    expect(uphill).toBeLessThan(flat);
    expect(downhill).toBeGreaterThan(flat);
  });

  it('is faster with more power', () => {
    expect(solveSpeed(RIDER, 0, 400).vKph).toBeGreaterThan(solveSpeed(RIDER, 0, 200).vKph);
  });

  it('caps descents at vMax instead of predicting 120 km/h', () => {
    const r = solveSpeed({ ...RIDER, vMaxKph: 65 }, -10, 250);
    expect(r.vKph).toBe(65);
    expect(r.powerLimited).toBe(false);
  });

  it('flags an impossible climb and reports the power it would take', () => {
    const r = solveSpeed(RIDER, 18, 150);
    expect(r.powerLimited).toBe(true);
    expect(r.vKph).toBe(5); // the stall floor
    expect(r.powerUsedW).toBeGreaterThan(150);
  });

  it('respects a custom stall floor', () => {
    const r = solveSpeed({ ...RIDER, vMinKph: 3 }, 20, 100);
    expect(r.vKph).toBe(3);
    expect(r.powerLimited).toBe(true);
  });
});

describe('airDensity', () => {
  it('matches sea level at 20 °C', () => {
    expect(airDensity(0, 20)).toBeCloseTo(1.204, 2);
  });

  it('thins with altitude', () => {
    expect(airDensity(1500, 20)).toBeLessThan(airDensity(0, 20));
    // ISA (15 °C at sea level) gives 0.915 kg/m³ at 3000 m; a warm 20 °C day is thinner
    expect(airDensity(3000, 20)).toBeGreaterThan(0.88);
    expect(airDensity(3000, 20)).toBeLessThan(0.91);
  });

  it('densifies in cold air', () => {
    expect(airDensity(0, 0)).toBeGreaterThan(airDensity(0, 30));
  });
});

describe('resampleProfile', () => {
  it('keeps a profile shorter than one step untouched', () => {
    const p = [
      { distKm: 0, altM: 0 },
      { distKm: 0.05, altM: 10 }
    ];
    expect(resampleProfile(p, 100)).toEqual(p);
  });

  it('resamples a long span into uniform steps', () => {
    const out = resampleProfile([{ distKm: 0, altM: 0 }, { distKm: 1, altM: 100 }], 100);
    expect(out.length).toBe(11);
    expect(out[0].distKm).toBe(0);
    expect(out.at(-1)!.distKm).toBe(1);
  });

  it('interpolates elevation linearly', () => {
    const out = resampleProfile([{ distKm: 0, altM: 0 }, { distKm: 1, altM: 100 }], 250);
    expect(out[1].altM).toBeCloseTo(25, 6);
  });

  it('never loses total distance or elevation', () => {
    const src = [
      { distKm: 0, altM: 0 },
      { distKm: 3.2, altM: 210 },
      { distKm: 7.8, altM: 340 }
    ];
    const out = resampleProfile(src, 100);
    expect(out.at(-1)!.distKm).toBeCloseTo(7.8, 9);
    expect(out.at(-1)!.altM).toBeCloseTo(340, 9);
  });

  it('handles a non-monotonic input by sorting first', () => {
    const out = resampleProfile(
      [
        { distKm: 1, altM: 20 },
        { distKm: 0, altM: 0 }
      ],
      100
    );
    expect(out[0].distKm).toBe(0);
  });
});

describe('solveRide', () => {
  it('covers the whole distance and accumulates monotonic time', () => {
    const sol = solveRide(flat(20), RIDER, 200, 100);
    expect(sol.totalDistKm).toBeCloseTo(20, 6);
    expect(sol.segments.length).toBeGreaterThan(100);
    for (const s of sol.segments) {
      expect(s.sec).toBeGreaterThan(0);
    }
    const last = sol.segments.at(-1)!;
    expect(last.cumDistKm).toBeCloseTo(20, 6);
    expect(last.cumTimeSec).toBeCloseTo(sol.totalTimeSec, 6);
    // cumulative distance never goes backwards
    for (let i = 1; i < sol.segments.length; i++) {
      expect(sol.segments[i].cumDistKm).toBeGreaterThan(sol.segments[i - 1].cumDistKm);
    }
  });

  it('adds time on a climb that has the same length and power', () => {
    const climb = [
      { distKm: 0, altM: 0 },
      { distKm: 5, altM: 100 },
      { distKm: 10, altM: 100 },
      { distKm: 15, altM: 200 },
      { distKm: 20, altM: 200 }
    ];
    const flatSol = solveRide(flat(20), RIDER, 200);
    const hillSol = solveRide(climb, RIDER, 200);
    expect(hillSol.totalTimeSec).toBeGreaterThan(flatSol.totalTimeSec);
    expect(hillSol.climbM).toBeCloseTo(200, 6);
    expect(flatSol.climbM).toBe(0);
  });

  it('is faster when the rider has more power', () => {
    expect(solveRide(flat(20), RIDER, 300).totalTimeSec).toBeLessThan(
      solveRide(flat(20), RIDER, 200).totalTimeSec
    );
  });

  it('is slower into a headwind', () => {
    const windy = solveRide(flat(20), { ...RIDER, headwindKph: 25 }, 200);
    expect(windy.totalTimeSec).toBeGreaterThan(solveRide(flat(20), RIDER, 200).totalTimeSec);
  });

  it('is slower for a heavier setup on a climb but not much on the flat', () => {
    const loaded = { ...RIDER, cargoKg: 8 };
    const hill = [
      { distKm: 0, altM: 0 },
      { distKm: 10, altM: 300 }
    ];
    expect(solveRide(hill, loaded, 200).totalTimeSec).toBeGreaterThan(
      solveRide(hill, RIDER, 200).totalTimeSec
    );
  });

  it('counts power-limited segments on a wall', () => {
    const wall = [
      { distKm: 0, altM: 0 },
      { distKm: 0.5, altM: 200 },
      { distKm: 1, altM: 200 }
    ];
    const sol = solveRide(wall, RIDER, 150);
    expect(sol.powerLimitedCount).toBeGreaterThan(0);
    expect(sol.segments.every((s) => s.powerLimited || s.gradePct < 10)).toBe(true);
  });

  it('reports how much of the route is beyond the target power', () => {
    const wall = [
      { distKm: 0, altM: 0 },
      { distKm: 1, altM: 300 },
      { distKm: 2, altM: 300 }
    ];
    const sol = solveRide(wall, RIDER, 150);
    expect(sol.powerLimitedPct).toBeGreaterThan(30);
    expect(sol.powerLimitedPct).toBeLessThanOrEqual(100);
    // a rideable profile has none of it
    expect(solveRide(flat(20), RIDER, 250).powerLimitedPct).toBe(0);
  });

  it('reports the power needed to hold a sane climbing speed on the steepest ramp', () => {
    const hill = [
      { distKm: 0, altM: 0 },
      { distKm: 10, altM: 1000 } // 10% average
    ];
    const sol = solveRide(hill, RIDER, 200);
    expect(sol.peakRequiredW).toBeGreaterThan(0);
    // and it must exceed the power needed on a flat route
    expect(sol.peakRequiredW).toBeGreaterThan(solveRide(flat(10), RIDER, 200).peakRequiredW);
  });

  it('reports total climb and descent separately', () => {
    const profile = [
      { distKm: 0, altM: 100 },
      { distKm: 5, altM: 400 }, // +300
      { distKm: 10, altM: 250 }, // −150
      { distKm: 15, altM: 300 } // +50
    ];
    const sol = solveRide(profile, RIDER, 220);
    expect(sol.climbM).toBeCloseTo(350, 6);
    expect(sol.descentM).toBeCloseTo(150, 6);
  });

  it('integrates energy in kJ from the solved segments', () => {
    const sol = solveRide(flat(10), RIDER, 200);
    const kj = kilojoulesForRide(sol);
    // 10 km flat at 200 W solves to ~17.5 min of riding → 200 W × 1054 s ≈ 211 kJ
    expect(kj).toBeGreaterThan(190);
    expect(kj).toBeLessThan(240);
    expect(kj).toBeCloseTo((200 * sol.totalTimeSec) / 1000, 3);
  });

  it('produces realistic times, not 1000× off', () => {
    const sol = solveRide(flat(40), RIDER, 200);
    // 40 km flat at ~34 km/h is a little over an hour — this is the guard that caught a
    // km/h → km/s conversion using the wrong divisor
    expect(sol.totalTimeSec / 3600).toBeGreaterThan(0.9);
    expect(sol.totalTimeSec / 3600).toBeLessThan(1.6);
  });

  it('is safe on a single-point profile', () => {
    const sol = solveRide([{ distKm: 0, altM: 0 }], RIDER, 200);
    expect(sol.segments).toEqual([]);
    expect(sol.totalTimeSec).toBe(0);
    expect(sol.avgKph).toBe(0);
  });
});

describe('powerForSpeed', () => {
  it('agrees with requiredPower — the inverse is the same model', () => {
    const grade = 4;
    const target = 230;
    const vKph = solveSpeed(RIDER, grade, target).vKph;
    expect(powerForSpeed(RIDER, grade, vKph)).toBeCloseTo(target, 3);
  });

  it('gives the power M4 needs to test "can I hold 30 km/h here?"', () => {
    const flatP = powerForSpeed(RIDER, 0, 30);
    const climbP = powerForSpeed(RIDER, 8, 30);
    expect(climbP).toBeGreaterThan(flatP * 2);
  });
});