import { describe, expect, it } from 'vitest';
import {
  baselineForTotal,
  derivedOdometerKm,
  legacyBaseline,
  migrateOdometerToBaseline,
  normalizeRestoredBikes,
  sumRideKmByBike
} from '../odometer';
import { isCyclingActivity, type Activity } from '../db';

/**
 * What these guard: the odometer is no longer a counter any writer increments — it is a
 * function of the activity table (data/odometer.ts). Every property here is one a rider
 * would notice breaking: a deleted ride that leaves kilometres behind, a migration that
 * moves the displayed figure, a re-sync that double-counts, a restore that collapses an
 * 8 000 km machine to its tracked subset.
 */

/** Minimal activity row shaped for the pure helpers. */
const ride = (id: string, km: number, bikeId?: string, extra: Partial<Activity> = {}): Activity =>
  ({
    id,
    date: '2026-10-01T06:00:00',
    name: id,
    source: 'strava',
    bikeId,
    distanceKm: km,
    movingSec: 3600,
    elapsedSec: 3600,
    elevGainM: 0,
    kcal: 500,
    updatedAt: 1,
    ...extra
  }) as Activity;

describe('sumRideKmByBike', () => {
  it('sums distance per bike and ignores rides with no bike', () => {
    const sums = sumRideKmByBike([
      { bikeId: 'a', distanceKm: 40 },
      { bikeId: 'b', distanceKm: 12 },
      { bikeId: 'a', distanceKm: 8.5 },
      { distanceKm: 99 } // walk, or an import that never picked a machine
    ]);
    expect(sums.get('a')).toBe(48.5);
    expect(sums.get('b')).toBe(12);
    expect(sums.size).toBe(2);
  });

  it('skips rows with a missing or non-finite distance instead of poisoning the total', () => {
    const sums = sumRideKmByBike([
      { bikeId: 'a', distanceKm: 10 },
      { bikeId: 'a' }, // distanceKm absent
      { bikeId: 'a', distanceKm: Number.NaN }
    ]);
    expect(sums.get('a')).toBe(10);
  });
});

describe('derivedOdometerKm / baselineForTotal / legacyBaseline', () => {
  it('read path: baseline + rides, treating a missing baseline as zero', () => {
    expect(derivedOdometerKm(1000, 48.5)).toBe(1048.5);
    expect(derivedOdometerKm(undefined, 48.5)).toBe(48.5);
  });

  it('form path: the total the rider types round-trips through the baseline', () => {
    // type 1048.5 with 48.5 km of rides tracked → stored baseline lands back on 1048.5
    const baseline = baselineForTotal(1048.5, 48.5);
    expect(derivedOdometerKm(baseline, 48.5)).toBe(1048.5);
  });

  it('form path: a total below the tracked sum is honoured, not clamped', () => {
    // rider corrects the machine down (odometer was wrong): 500 shown over 800 of rides
    const baseline = baselineForTotal(500, 800);
    expect(baseline).toBe(-300);
    expect(derivedOdometerKm(baseline, 800)).toBe(500);
  });

  it('form path: a brand-new bike with no rides stores the typed total as-is', () => {
    expect(derivedOdometerKm(baselineForTotal(120, 0), 0)).toBe(120);
  });

  it('legacy conversion preserves the old displayed value bit for bit', () => {
    // old counter 1200 had already counted the 251.3 km of rides it carried
    const baseline = legacyBaseline(1200, 251.3);
    expect(derivedOdometerKm(baseline, 251.3)).toBe(1200);
  });

  it('legacy conversion keeps a counter that was below its own ride sum (no clamp)', () => {
    // a counter corrected down by hand, then rides deleted: the figure must not jump
    const baseline = legacyBaseline(300, 420);
    expect(derivedOdometerKm(baseline, 420)).toBe(300);
  });
});

describe('migrateOdometerToBaseline (schema v3)', () => {
  // typed as the shape a pre-v3 row arrives in: the legacy counter, optional baseline
  // (the generic accepts either generation), afterwards optional on the migrated row.
  const bike = (id: string, odo: number, active = false) =>
    ({ id, odometerKm: odo, active }) as { id: string; odometerKm?: number; baselineKm?: number; active: boolean };

  /** Row shape the migration returns: baseline filed, counter gone. */
  type Migrated = { id: string; baselineKm?: number; odometerKm?: number; active?: boolean };

  it('the displayed figure does not move by a single kilometre', () => {
    const bikes = [bike('road', 1200, true)];
    const acts = [
      ride('r1', 42, undefined, { odometerCreditedAt: 5 }), // counted by the old credit
      ride('r2', 24.1, undefined, { odometerCreditedAt: 5 }),
      ride('r3', 18.5) // never counted: pre-credit Strava ride
    ];

    const out = migrateOdometerToBaseline(bikes, acts, isCyclingActivity);
    const road = out.bikes.find((b) => b.id === 'road')!;

    // stamped rides are attributed to the active bike; the unstamped one is left alone
    const attributed = out.activities;
    expect(attributed.map((a) => a.id)).toEqual(['r1', 'r2']);
    expect(attributed.every((a) => a.bikeId === 'road')).toBe(true);

    // Σ of what the migrated state will display: baseline + attributed rides
    const rideKm = attributed.reduce((s, a) => s + a.distanceKm, 0);
    expect(derivedOdometerKm(road.baselineKm, rideKm)).toBe(1200);

    // the counter field is gone from the written rows
    expect('odometerKm' in road).toBe(false);
  });

  it('an unstamped ride stays unattributed — the odometer must not grow during upgrade', () => {
    const bikes = [bike('road', 500, true)];
    const acts = [ride('old', 42)]; // synced before the credit existed

    const out = migrateOdometerToBaseline(bikes, acts, isCyclingActivity);
    expect(out.activities).toEqual([]);
    expect(derivedOdometerKm(out.bikes[0].baselineKm, 0)).toBe(500);
  });

  it('a walk is never attributed, even when stamped', () => {
    const bikes = [bike('road', 1000, true)];
    const acts = [ride('walk', 5, undefined, { odometerCreditedAt: 1, sportType: 'Walk' })];

    const out = migrateOdometerToBaseline(bikes, acts, isCyclingActivity);
    expect(out.activities).toEqual([]);
    expect(derivedOdometerKm(out.bikes[0].baselineKm, 0)).toBe(1000);
  });

  it('with an empty stable the credit dies with the deleted bike, as it always had', () => {
    const acts = [ride('r1', 42, undefined, { odometerCreditedAt: 5 })];
    const out = migrateOdometerToBaseline([], acts, isCyclingActivity);
    expect(out.activities).toEqual([]);
  });

  it('a zero-distance row is neither attributed nor summed', () => {
    const bikes = [bike('road', 700, true)];
    const acts = [ride('zero', 0, undefined, { odometerCreditedAt: 1 })];
    const out = migrateOdometerToBaseline(bikes, acts, isCyclingActivity);
    expect(out.activities).toEqual([]);
  });

  it('rides already attributed (importer-era rows) keep their bike and their place in the sum', () => {
    const bikes = [bike('road', 900, true), bike('gravel', 300)];
    const acts = [ride('r1', 60, 'gravel')];

    const out = migrateOdometerToBaseline(bikes, acts, isCyclingActivity);
    const road = out.bikes.find((b) => b.id === 'road')!;
    const gravel = out.bikes.find((b) => b.id === 'gravel')!;

    // gravel's counter already contained its ride: baseline = counter − sum
    expect(derivedOdometerKm(gravel.baselineKm, 60)).toBe(300);
    // road had no rides: baseline is the whole figure
    expect(derivedOdometerKm(road.baselineKm, 0)).toBe(900);
  });

  it('is idempotent: migrating migrated rows changes nothing', () => {
    const bikes = [bike('road', 1200, true)];
    const acts = [ride('r1', 42, undefined, { odometerCreditedAt: 5 })];

    const once = migrateOdometerToBaseline(bikes, acts, isCyclingActivity);
    const twice = migrateOdometerToBaseline<Migrated, (typeof once.activities)[number]>(
      once.bikes,
      once.activities,
      isCyclingActivity
    );

    expect(twice.activities).toEqual([]);
    expect(twice.bikes.map((b) => b.baselineKm)).toEqual(once.bikes.map((b) => b.baselineKm));
  });
});

describe('normalizeRestoredBikes (pre-v3 backup files)', () => {
  it('freezes the baseline from the file’s own rides so the restored figure matches', () => {
    // exported when the counter read 8 412, with 649.5 km of rides in the same file
    const bikes: Array<{ id: string; odometerKm?: number; baselineKm?: number }> = [{
      id: 'road',
      odometerKm: 8412
    }];
    const acts = [{ bikeId: 'road', distanceKm: 649.5 }];

    const out = normalizeRestoredBikes(bikes, acts);
    expect(out[0].baselineKm).toBe(8412 - 649.5);
    expect('odometerKm' in out[0]).toBe(false);
    expect(derivedOdometerKm(out[0].baselineKm, 649.5)).toBe(8412);
  });

  it('leaves current-format rows (already carrying a baseline) untouched', () => {
    const bikes = [{ id: 'road', baselineKm: 7762.5 }];
    expect(normalizeRestoredBikes(bikes, [])).toEqual(bikes);
  });

  it('leaves rows without either field untouched', () => {
    const bikes = [{ id: 'ghost' }];
    expect(normalizeRestoredBikes(bikes, [])).toEqual(bikes);
  });

  it('does not mutate the input rows', () => {
    const bikes: Array<{ id: string; odometerKm?: number; baselineKm?: number }> = [{
      id: 'road',
      odometerKm: 8412
    }];
    normalizeRestoredBikes(bikes, []);
    expect(bikes[0].odometerKm).toBe(8412);
  });
});
