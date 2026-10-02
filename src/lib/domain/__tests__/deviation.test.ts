import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPlan, type PacingStrategy } from '../pacing';
import type { PhysicsParams, ProfilePoint } from '../physics';

/**
 * The device half of the DoD item "deviasi estimasi vs ride nyata di rute sama
 * < ±7 %" (ROADMAP.md, M3).
 *
 * No bike has ever been attached to this project, so **this box is still empty** and
 * `validation.test.ts` is what stands in for it meanwhile. What this file guarantees is
 * that the box can be closed the day a real ride exists: drop a JSON export into
 * `validation/rides/`, and the ordinary `npm test` gate will predict that ride through
 * the app's own planner and fail if the estimate is more than 7 % off the clock.
 *
 * Two deliberate choices, both about not fooling ourselves:
 *
 * - A ride file must carry `"verified": true`. Without that field the ride is loaded,
 *   printed and skipped, so a copied demo ride cannot turn the box green by accident.
 * - The gate is on the *mean* absolute deviation across every verified ride, not on a
 *   single ride. One accidentally easy route should not be able to carry a set of
 *   predictions that are systematically wrong.
 *
 * See `validation/rides/README.md` for the file format and how to produce one.
 */

const TOLERANCE_PCT = 7;

/** One real ride, as recorded by a device. See validation/rides/README.md. */
interface RideRecord {
  name: string;
  date: string;
  /**
   * The rider's word that this is a genuine device recording of a genuine ride.
   * Missing or false means "do not count this toward the gate".
   */
  verified?: boolean;
  actual: { movingSec: number; distanceKm: number; elevGainM?: number };
  rider: { massKg: number; bikeKg: number; crr?: number; cda?: number };
  pacing: PacingStrategy;
  profile: ProfilePoint[];
  notes?: string;
}

// Resolved from the working directory, not `import.meta.url`: this suite runs under the
// happy-dom environment, where `import.meta.url` is not a file URL. Vitest is invoked
// from the project root by `npm test`, so cwd is the right anchor.
const validationDir = resolve(process.cwd(), 'validation');
const ridesDir = resolve(validationDir, 'rides');
const examplePath = resolve(validationDir, 'example-ride.json');

function load(dir: string): RideRecord[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as RideRecord);
}

function physicsOf(r: RideRecord): PhysicsParams {
  return {
    riderKg: r.rider.massKg,
    bikeKg: r.rider.bikeKg,
    crr: r.rider.crr ?? 0.005,
    cda: r.rider.cda ?? 0.32,
    drivetrainLoss: 0.025
  };
}

/** Predict moving seconds for a recorded ride, using only what a planner would know. */
function predictSec(r: RideRecord): number {
  const plan = buildPlan({
    profile: r.profile,
    physics: physicsOf(r),
    pacing: r.pacing,
    // Stops are not part of moving time, and the actual figure is moving time too.
    stops: { count: 0, minutesEach: 0 },
    startMin: 0
  });
  if (!plan.ok) throw new Error(`${r.name}: ${plan.reason}`);
  // `RidePlan.ok` is a plain boolean, so the success branch does not narrow. An honest
  // guard beats a non-null assertion: a plan that is ok but has no duration is exactly
  // the failure this harness exists to catch.
  const movingSec = plan.movingSec;
  if (movingSec == null) throw new Error(`${r.name}: plan is ok but produced no duration`);
  return movingSec;
}

const deviationPct = (predictedSec: number, actualSec: number) =>
  ((predictedSec - actualSec) / actualSec) * 100;

const rides = load(ridesDir);
const verified = rides.filter((r) => r.verified === true);

// ── The harness itself, always exercised ────────────────────────────────────────────
// Without this the entire skip below would be untested code, and a bug in the loader
// would only surface on the day somebody finally rides a bike.
describe('deviation harness — plumbing', () => {
  const example = JSON.parse(readFileSync(examplePath, 'utf8')) as RideRecord;

  it('reads the documented example and runs it end to end', () => {
    expect(example.name.length).toBeGreaterThan(0);
    expect(example.profile.length).toBeGreaterThanOrEqual(2);
    expect(example.actual.movingSec).toBeGreaterThan(0);

    const sec = predictSec(example);
    expect(sec).toBeGreaterThan(0);
    // The example is a 100 km alpine route; a 70 kg rider on 220 W should not be told
    // it takes four minutes. This is a smoke test on the magnitude, not a claim that
    // the example is accurate — it carries no `verified` flag precisely because it is
    // a made-up profile.
    expect(sec / 60).toBeGreaterThan(120);
    expect(sec / 60).toBeLessThan(600);
  });

  it('rejects a ride file with no usable profile', () => {
    const broken = { ...example, profile: [{ distKm: 0, altM: 0 }] };
    expect(() => predictSec(broken)).toThrow(/empty/i);
  });

  it('does not count an unverified ride', () => {
    expect(example.verified).not.toBe(true);
    expect(rides.filter((r) => r.verified !== true)).toHaveLength(
      rides.length - verified.length
    );
  });

  it('signs the deviation so over- and under-prediction cannot cancel out', () => {
    // A model that is always 10 % fast fails the mean-absolute gate; averaging signed
    // deviations would let a 10 % slow ride hide it, which is why the gate below uses
    // absolute values.
    expect(deviationPct(110, 100)).toBeCloseTo(10, 6);
    expect(deviationPct(90, 100)).toBeCloseTo(-10, 6);
    expect(Math.abs(deviationPct(90, 100))).toBeGreaterThan(TOLERANCE_PCT);
  });
});

// ── The gate itself ──────────────────────────────────────────────────────────────────
const describeVerified = verified.length > 0 ? describe : describe.skip;

describeVerified('deviasi estimasi vs ride nyata < ±7 %', () => {
  it(`every verified ride is within ±${TOLERANCE_PCT} %`, () => {
    const rows = verified.map((r) => {
      const predictedSec = predictSec(r);
      const dev = deviationPct(predictedSec, r.actual.movingSec);
      return {
        name: r.name,
        predicted: (predictedSec / 60).toFixed(1),
        actual: (r.actual.movingSec / 60).toFixed(1),
        dev
      };
    });

    // Always print the table — this is the number a rider wants to read, pass or fail.
    const table = rows
      .map((r) => `  ${r.name.padEnd(28)} ${r.predicted} min predicted vs ${r.actual} min actual → ${r.dev >= 0 ? '+' : ''}${r.dev.toFixed(1)} %`)
      .join('\n');
    console.log(`\nGowsLab prediction accuracy over ${rows.length} verified ride(s):\n${table}`);

    for (const r of rows) {
      expect(
        Math.abs(r.dev),
        `${r.name}: ${r.predicted} min predicted vs ${r.actual} min actual → ${r.dev.toFixed(1)} %`
      ).toBeLessThanOrEqual(TOLERANCE_PCT);
    }
  });

  it(`the mean absolute deviation stays under ±${TOLERANCE_PCT} %`, () => {
    const devs = verified.map((r) => Math.abs(deviationPct(predictSec(r), r.actual.movingSec)));
    const mean = devs.reduce((a, b) => a + b, 0) / devs.length;
    console.log(`  mean absolute deviation: ${mean.toFixed(1)} %`);
    expect(mean).toBeLessThanOrEqual(TOLERANCE_PCT);
  });
});

if (verified.length === 0) {
  it('the ±7 % DoD box is still open — no verified rides in validation/rides/', () => {
    // An `it` rather than a comment, so the gap stays visible in the test output
    // instead of quietly disappearing into a skipped block.
    expect(verified).toHaveLength(0);
    console.log(
      `\n  prediction accuracy: NOT YET MEASURED ` +
        `(${rides.length} ride file(s) present, 0 verified — see validation/rides/README.md)`
    );
  });
}