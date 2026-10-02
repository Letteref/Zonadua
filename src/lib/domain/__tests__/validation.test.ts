import { describe, expect, it } from 'vitest';
import {
  GRAVITY,
  airDensity,
  requiredPower,
  resampleProfile,
  solveRide,
  solveSpeed,
  type PhysicsParams,
  type ProfilePoint
} from '../physics';
import { buildPlan, planSeries } from '../pacing';
import { clockAtKm, kmAtClock } from '../race';

/**
 * Validation harness — the in-repo half of the DoD item "deviasi estimasi vs ride
 * nyata di rute sama < ±7 %" (ROADMAP.md M3).
 *
 * The other half needs a real bike on a real road, and no device has ever been
 * attached to this project, so that box is still honestly unchecked. What this file
 * does is make sure the *other* question is not left open either: is the model
 * itself right?
 *
 * A unit test that compares `solveRide` to `solveSpeed` proves the solver is
 * consistent with itself and nothing more — if both share a wrong sign, a wrong
 * km/h ÷ 3.6, or a wrong drivetrain direction, they agree perfectly and the app is
 * confidently wrong. So the three layers below are deliberately *not* self-referential:
 *
 *   1. **Published anchors.** Numbers taken from cycling literature and the ICAO
 *      standard atmosphere, written down as literals, compared against the model's
 *      output. These fail if the physics is wrong, not if it is inconsistent.
 *   2. **Algebraic identities that must close exactly.** Forward/inverse agreement,
 *      headwind-versus-ground-speed equivalence, energy-per-second conservation.
 *   3. **Bookkeeping over whole route profiles.** Distance, time, elevation and
 *      cumulative columns must sum to their stated totals on profiles with real
 *      corners in them — the seam bugs that keep turning up in this codebase.
 *
 * See `deviation.test.ts` for the device half, and `validation/rides/README.md` for how to
 * feed a real ride in.
 */

// A reference rider: 80 kg all-up (68 rider + 12 bike), road position, 30 mm tyres.
const REF: PhysicsParams = {
  riderKg: 68,
  bikeKg: 12,
  crr: 0.005,
  cda: 0.32,
  drivetrainLoss: 0.025,
  // Pinned so layer 1 measures the power model, not the atmosphere model. The
  // atmosphere has its own anchors in the first describe block.
  airDensity: 1.225
};

describe('layer 1 — the model against published numbers', () => {
  it('matches the ICAO standard atmosphere', () => {
    // ISA density at 15 °C sea level is 1.225 kg/m³ by definition; the 1000 m and
    // 5000 m rows are the standard atmosphere table.
    expect(airDensity(0, 15)).toBeCloseTo(1.225, 3);
    expect(airDensity(1000, 15)).toBeCloseTo(1.112, 3);
    expect(airDensity(5000, 15)).toBeCloseTo(0.7364, 3);
  });

  it('needs ~150 W to hold 30 km/h on the flat', () => {
    // Hand-derived from the textbook terms, deliberately not by calling the model:
    //   rolling = Crr·m·g·v          = 0.005 × 80 × 9.80665 × 8.3333 =  32.689 W
    //   aero    = ½ρ·CdA·v³          = 0.5 × 1.225 × 0.32 × 578.70  = 113.426 W
    //   at the wheel                  = 146.115 W
    //   at the pedals, ÷ (1 − 0.025)   = 149.861 W
    // This is the widely quoted figure for an 80 kg rider cruising at 30 km/h.
    expect(requiredPower(REF, 0, 30)).toBeCloseTo(149.86, 1);
  });

  it('needs ~485 W to hold 30 km/h up a 5 % ramp', () => {
    // θ = atan(0.05): sin = 0.0499376, cos = 0.9987520
    //   gravity = m·g·v·sinθ         = 6537.77 × 0.0499376 = 326.475 W
    //   rolling = Crr·m·g·cosθ·v      =   32.648 W
    //   aero    =                    =  113.426 W
    //   at the pedals                 = 472.549 / 0.975  = 484.666 W
    expect(requiredPower(REF, 5, 30)).toBeCloseTo(484.67, 1);
  });

  it('gives back the same watts downhill, which is the sign test', () => {
    // −5 %: gravity changes sign, rolling and aero do not.
    //   gravity = −326.475 W → wheel = −180.401 W → pedals = −185.027 W
    // A model that dropped the sign here would report a descent as a climb and make
    // every descent look slower than the flat before it.
    expect(requiredPower(REF, -5, 30)).toBeCloseTo(-185.03, 1);
  });

  it('scales with the square-plus-cubic law: doubling CdA raises aero, not the climb', () => {
    const base = requiredPower(REF, 0, 30);
    const highCda = requiredPower({ ...REF, cda: 0.64 }, 0, 30);
    const baseClimb = requiredPower(REF, 8, 15);
    const highCdaClimb = requiredPower({ ...REF, cda: 0.64 }, 8, 15);

    // Doubling CdA adds exactly 2×113.426 W of aero at the wheel, plus the same 2.5 %
    // on that extra slice — it does not touch rolling resistance.
    const delta = (highCda - base) * (1 - REF.drivetrainLoss!);
    expect(delta).toBeCloseTo(113.426, 2);

    // On an 8 % climb the aero share is small, so the same change is a far smaller
    // fraction of the total. If this came out equal, grade would not be reaching the
    // aero term at all.
    expect((highCdaClimb - baseClimb) / baseClimb).toBeLessThan((highCda - base) / base);
  });

  it('keeps the 2.5 % drivetrain loss on the wheel watts only', () => {
    const losses = [0, 0.025, 0.05];
    const wheel = losses.map((l) => requiredPower({ ...REF, drivetrainLoss: l }, 0, 30) * (1 - l));
    for (const w of wheel) expect(w).toBeCloseTo(146.115, 2);
  });
});

describe('layer 2 — identities that must close exactly', () => {
  it('a solved speed demands the power that was actually spent', () => {
    // `powerUsedW` is the solver's own statement of what a segment costs. Re-deriving
    // it from the forward model at the returned speed must reproduce it *in every
    // branch* — including the two bounds, where the honest answer is "you are crawling
    // or you are capped, and here is what that really costs" rather than the target.
    //
    // For the interior case the re-derived power must additionally be the target,
    // which is what catches a wrong bisection bracket or a km/h/m/s slip. Skipping the
    // bounded cases is not a loosening: the first loop still covers them.
    let interior = 0;
    let bounded = 0;
    for (const grade of [-8, -3, 0, 2, 5, 9, 14]) {
      for (const watts of [120, 180, 220, 275, 330, 400]) {
        const { vKph, powerLimited, powerUsedW } = solveSpeed(REF, grade, watts);
        expect(requiredPower(REF, grade, vKph)).toBeCloseTo(powerUsedW, 3);

        const atBound = vKph <= (REF.vMinKph ?? 5) || vKph >= (REF.vMaxKph ?? 65);
        if (!atBound) {
          expect(requiredPower(REF, grade, vKph)).toBeCloseTo(watts, 3);
          expect(powerLimited).toBe(false);
          interior++;
        } else {
          bounded++;
        }
      }
    }
    expect(interior).toBeGreaterThan(20);
    expect(bounded).toBeGreaterThan(0);
  });

  it('charges a headwind for the extra air only, never for the extra work', () => {
    // A headwind adds air speed; it does not change ground speed. Gravity and rolling
    // resistance both scale with how fast the rider covers ground, so those two terms
    // must be untouched — the entire cost of the wind is the cubic aero difference:
    //   Δ = ½ρCdA[(v+w)³ − v³] ÷ (1 − loss)
    //   = 0.196 × (1371.742 − 578.704) / 0.975 = 159.42 W
    // An earlier draft of this test asserted the wrong thing — that 30 km/h into a
    // 10 km/h wind should cost the same as 40 km/h in calm. It should not: on the
    // flat the aero matches but the rolling resistance does not, and on a climb the
    // gravity term differs too. Same air, different ground.
    const v = 30;
    const airDelta =
      (0.5 * 1.225 * 0.32 * ((v + 10) / 3.6) ** 3 - 0.5 * 1.225 * 0.32 * (v / 3.6) ** 3) /
      (1 - 0.025);

    for (const grade of [-4, 0, 3, 7]) {
      const withWind = requiredPower({ ...REF, headwindKph: 10 }, grade, v);
      const calm = requiredPower(REF, grade, v);
      expect(withWind - calm).toBeCloseTo(airDelta, 3);
    }
  });

  it('makes a headwind hurt more the faster the rider goes', () => {
    const costOfWind = (v: number, h: number) =>
      requiredPower({ ...REF, headwindKph: h }, 0, v) - requiredPower(REF, 0, v);
    // Aero is cubic in air speed, so a 10 km/h headwind is a far bigger bill at 40 km/h
    // than at 20. If a headwind were modelled as a flat surcharge this would be a
    // straight line and the ratio would sit at 1.
    expect(costOfWind(40, 10) / costOfWind(20, 10)).toBeGreaterThan(3);
    expect(costOfWind(10, 10)).toBeLessThan(costOfWind(20, 10));
  });

  it('is monotonic in speed and in gradient', () => {
    for (const grade of [0, 5, 10]) {
      let prev = -Infinity;
      for (let v = 8; v <= 45; v += 2) {
        const p = requiredPower(REF, grade, v);
        expect(p).toBeGreaterThan(prev);
        prev = p;
      }
    }
    let prev = -Infinity;
    for (let g = -10; g <= 15; g += 1) {
      const p = requiredPower(REF, g, 25);
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });

  it('spends the same joules the rider asked for', () => {
    // 20 km of rolling road at 220 W: energy in = watts × time. A segment whose
    // `powerUsedW` disagrees with its own duration would break this.
    const profile: ProfilePoint[] = [];
    for (let km = 0; km <= 20; km += 0.5) profile.push({ distKm: km, altM: 50 + 40 * Math.sin(km / 3) });

    const sol = solveRide(profile, REF, 220);
    expect(sol.powerLimitedCount).toBe(0);
    expect(sol.totalTimeSec).toBeGreaterThan(0);

    const kj = sol.segments.reduce((a, s) => a + (s.powerUsedW * s.sec) / 1000, 0);
    expect(kj).toBeCloseTo((220 * sol.totalTimeSec) / 1000, 6);
  });
});

describe('layer 3 — bookkeeping over whole routes', () => {
  const profiles: Record<string, ProfilePoint[]> = {
    flat: Array.from({ length: 41 }, (_, i) => ({ distKm: i, altM: 30 })),
    rolling: Array.from({ length: 161 }, (_, i) => ({
      distKm: i * 0.5,
      altM: 100 + 80 * Math.sin(i / 7) + 30 * Math.sin(i / 2.3)
    })),
    alpine: [
      { distKm: 0, altM: 400 },
      { distKm: 20, altM: 1200 },
      { distKm: 40, altM: 2400 },
      { distKm: 60, altM: 2410 },
      { distKm: 80, altM: 900 },
      { distKm: 100, altM: 120 }
    ],
    descentHeavy: [
      { distKm: 0, altM: 1500 },
      { distKm: 15, altM: 200 },
      { distKm: 30, altM: 180 },
      { distKm: 45, altM: 1500 }
    ]
  };

  for (const [name, profile] of Object.entries(profiles)) {
    it(`${name}: distance, time and elevation sum to the stated totals`, () => {
      const sol = solveRide(profile, REF, 250);

      const lengthKm = profile.at(-1)!.distKm;
      expect(sol.totalDistKm).toBeCloseTo(lengthKm, 6);
      expect(sol.segments.at(-1)!.cumDistKm).toBeCloseTo(lengthKm, 6);

      // Time must accumulate from the segments, not be computed beside them.
      const summed = sol.segments.reduce((a, s) => a + s.sec, 0);
      expect(summed).toBeCloseTo(sol.totalTimeSec, 6);
      expect(sol.avgKph).toBeCloseTo(sol.totalDistKm / (sol.totalTimeSec / 3600), 6);

      // Net elevation must equal last-minus-first over the resampled polyline.
      const netFromSegments = sol.segments.reduce((a, s) => a + s.riseM, 0);
      const netFromEnds = profile.at(-1)!.altM - profile[0].altM;
      expect(netFromSegments).toBeCloseTo(netFromEnds, 3);

      // Cumulative columns are monotone: a checkpoint lookup that walks these must
      // never step backwards.
      let prevKm = 0;
      let prevSec = 0;
      for (const s of sol.segments) {
        expect(s.cumDistKm).toBeGreaterThan(prevKm);
        expect(s.cumTimeSec).toBeGreaterThan(prevSec);
        prevKm = s.cumDistKm;
        prevSec = s.cumTimeSec;
      }
      expect(sol.segments.every((s) => s.sec > 0)).toBe(true);
    });
  }

  it('resampling keeps every vertex and the total length', () => {
    const p = profiles.alpine;
    const r = resampleProfile(p, 100);
    expect(r.at(-1)!.distKm).toBeCloseTo(p.at(-1)!.distKm, 6);
    expect(r.at(-1)!.altM).toBeCloseTo(p.at(-1)!.altM, 6);
    expect(r.length).toBeGreaterThan(900);
    for (let i = 1; i < r.length; i++) expect(r[i].distKm).toBeGreaterThan(r[i - 1].distKm);

    // A resample is a re-spacing, never an interpolation that invents or loses climb:
    // the climb it reports must match the climb of the original polyline.
    const climbOf = (pts: readonly ProfilePoint[]) =>
      pts.reduce((a, q, i) => (i === 0 ? 0 : a + Math.max(0, q.altM - pts[i - 1].altM)), 0);
    expect(climbOf(r)).toBeCloseTo(climbOf(p), 3);
  });

  it('places a mid-distance checkpoint where the terrain says, not halfway in time', () => {
    // Half the *distance* is emphatically not half the *time* on a road that climbs.
    // The checkpoint table and the series it is read back through are separate
    // arithmetic from the segment walk, so this checks both — and it checks the
    // *direction* of the terrain effect, which is the thing a broken grade sign flips:
    // on the alpine profile the climbing half must eat more than half the time, and
    // on the descent-led profile less than half.
    const expected: Record<string, (frac: number) => boolean> = {
      flat: (f) => Math.abs(f - 0.5) < 1e-6,
      rolling: (f) => f > 0.45 && f < 0.55,
      alpine: (f) => f > 0.6,
      descentHeavy: (f) => f < 0.35
    };

    for (const [name, profile] of Object.entries(profiles)) {
      const plan = buildPlan({
        profile,
        physics: REF,
        pacing: { mode: 'constant', watts: 250 },
        stops: { count: 0, minutesEach: 0 },
        startMin: 7 * 60,
        checkpoints: [{ km: profile.at(-1)!.distKm / 2, label: 'half' }]
      });
      expect(plan.ok).toBe(true);
      const movingSec = plan.movingSec;
      if (movingSec == null) throw new Error(`${name}: plan is ok but produced no duration`);
      const series = planSeries(plan, 2000);

      const half = plan.checkpoints[0];
      expect(half.km).toBeCloseTo(profile.at(-1)!.distKm / 2, 6);
      expect(expected[name](half.elapsedSec / movingSec)).toBe(true);

      // `clockAtKm` answers in clock minutes, not elapsed minutes — the 07:00 start
      // has to be in there, which is exactly why the two are different numbers.
      expect(clockAtKm(series, half.km)!).toBeCloseTo(half.clockMin, 1);
      expect(kmAtClock(series, half.clockMin)!).toBeCloseTo(half.km, 1);
      expect(clockAtKm(series, plan.finishClockMin!)!).toBeCloseTo(
        plan.finishClockMin!,
        1
      );
    }
  });

  it('a rider who cannot hold the target is told so rather than shown a crawl', () => {
    // The alpine profile tops out at 12 % just after the 40 km mark. At 250 W the wall
    // is out of reach, and the honest answer is "power limited" — not a confident ETA
    // computed from a 5 km/h crawl, which is the failure mode this guards.
    // 30 km of unbroken 12 %: every 500 m step climbs 60 m.
    const steep = Array.from({ length: 61 }, (_, i) => ({
      distKm: i * 0.5,
      altM: 400 + i * 60
    }));
    const weak = solveRide(steep, REF, 120);
    expect(weak.powerLimitedCount).toBeGreaterThan(0);
    expect(weak.powerLimitedPct).toBeGreaterThan(50);

    // Required power at the crawl speed must genuinely exceed what the rider has,
    // otherwise the flag is lying.
    for (const s of weak.segments.filter((x) => x.powerLimited)) {
      expect(s.powerUsedW).toBeGreaterThan(120);
    }
    expect(weak.peakRequiredW).toBeGreaterThan(120);
  });
});

/** Sanity anchor so the harness cannot pass on an empty or degenerate model. */
describe('harness sanity', () => {
  it('the reference rider is plausible', () => {
    expect(GRAVITY).toBeCloseTo(9.80665, 5);
    const flat30 = requiredPower(REF, 0, 30);
    expect(flat30).toBeGreaterThan(100);
    expect(flat30).toBeLessThan(200);
  });
});