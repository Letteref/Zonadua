import { describe, expect, it, vi } from 'vitest';
import { derivedOdometerKm, sumRideKmByBike } from '../odometer';
import type { Bike, BikeComponent } from '../db';

/**
 * What these guard: a component's service clock (chain, cassette, pads — WASPADA at
 * >=90 %, KRITIS at >=100 % of the interval, UI-SPEC) is measured against the bike's
 * *derived* odometer — `baselineKm + SUM(distanceKm)` of the attributed rides — and
 * never against a stored counter.
 *
 * Two seams, both real production code:
 *
 *  1. `allBikesWithComponents` is the store Gear / ReminderBell / Dashboard read. It is
 *     run over a mocked `db` (fake tables, not `fake-indexeddb` — see the note in
 *     recompute-synthetic.test.ts) because the join itself is the claim: the figure the
 *     wear bar receives must be rebuilt from the activity table on every read. A bike row
 *     carrying a planted legacy `odometerKm` (12 000 km, against 4 412 km of reality)
 *     proves the stale counter cannot leak into that figure.
 *
 *  2. `computeWear` is then driven through the scenarios a stored counter could not
 *     survive: deleting a ride pays its kilometres back, a re-sync overwriting the same
 *     rows changes nothing, a walk advances nothing, and servicing resets at the
 *     derived figure.
 */

/** Rows the mocked `db` serves. Hoisted so the `vi.mock` factory shares the arrays. */
const heap = vi.hoisted(() => ({
  bikes: [] as unknown[],
  components: [] as unknown[],
  activities: [] as unknown[]
}));

vi.mock('../db', () => {
  const empty: unknown[] = [];
  const byName: Record<string, unknown[]> = {
    bikes: heap.bikes,
    components: heap.components,
    activities: heap.activities
  };

  /** Chainable fake table: any fluent call returns the same chain, reads return rows. */
  const table = (rows: () => unknown[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'toArray') return async () => rows().slice();
          if (prop === 'get') return async (id: string) => rows().find((r) => (r as { id?: string })?.id === id);
          if (prop === 'equals')
            return (value: string) => table(() => rows().filter((r) => (r as { bikeId?: string })?.bikeId === value));
          // never thenable: `await` on this chain would recurse forever
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
          return () => table(rows);
        }
      }
    );

  return {
    db: new Proxy({}, { get: (_target, prop) => table(() => byName[String(prop)] ?? empty) }),
    // the store filters ride windows with the same predicate the importer uses
    isCyclingActivity: (act: { sportType?: string }) => act.sportType === undefined || act.sportType === 'Ride'
  };
});

// ---- rows in place BEFORE the store module loads: `wrap()` subscribes at import, so the
// first (and, against fake tables, only) emission must already see them ----
heap.bikes.push(
  {
    id: 'road',
    name: 'Castorcli',
    type: 'road',
    weightKg: 7.4,
    crr: 0.004,
    cda: 0.36,
    baselineKm: 4000,
    active: true,
    updatedAt: 1,
    // a pre-v3 counter left on the row: 7 588 km above the truth, on purpose
    odometerKm: 12_000
  } as Bike,
  {
    id: 'gravel',
    name: 'Gravel',
    type: 'gravel',
    weightKg: 9.1,
    crr: 0.005,
    cda: 0.38,
    baselineKm: 800,
    active: false,
    updatedAt: 1
  } as Bike
);
heap.components.push({
  id: 'chain',
  bikeId: 'road',
  name: 'Chain',
  kind: 'chain',
  // installed when road's derived odometer already stood at 4000 baseline + 412 rides
  installedAtOdoKm: 4412,
  intervalKm: 4000,
  updatedAt: 1
} as BikeComponent);
heap.activities.push(
  { id: 'r1', date: '2026-09-01T06:00:00', name: 'r1', source: 'strava', bikeId: 'road', distanceKm: 300, movingSec: 3600, elapsedSec: 3600, updatedAt: 1 },
  { id: 'r2', date: '2026-09-04T06:00:00', name: 'r2', source: 'strava', bikeId: 'road', distanceKm: 112, movingSec: 3600, elapsedSec: 3600, updatedAt: 1 },
  { id: 'g1', date: '2026-09-05T06:00:00', name: 'g1', source: 'gpx', bikeId: 'gravel', distanceKm: 150, movingSec: 3600, elapsedSec: 3600, updatedAt: 1 },
  // a walk: no bikeId, so it belongs to no odometer
  { id: 'w1', date: '2026-09-06T06:00:00', name: 'w1', source: 'strava', bikeId: undefined, distanceKm: 60, sportType: 'Walk', movingSec: 3600, elapsedSec: 3600, updatedAt: 1 }
);

const q = await import('../queries.svelte');

/** road's row out of a loaded join — the shape every store consumer reads. */
const roadOf = (rows: Awaited<ReturnType<typeof q.loadBikesWithComponents>>) =>
  rows.find((j) => j.bike.id === 'road')!;

describe('the store join builds a derived odometer, not the planted counter', () => {
  it('builds odometerKm from baseline + attributed rides, ignoring a legacy counter on the row', async () => {
    const joined = roadOf(await q.loadBikesWithComponents());

    expect(joined.rideKm).toBe(412);
    expect(joined.odometerKm).toBe(4412); // 4000 baseline + 300 + 112 — the walk is excluded
    // the stale counter is still on the raw row, and it never reaches the figure
    expect('odometerKm' in joined.bike).toBe(true);
    expect(joined.odometerKm).not.toBe(12_000);

    // every machine gets its own odometer from its own rides
    const rows = await q.loadBikesWithComponents();
    const gravel = rows.find((j) => j.bike.id === 'gravel')!;
    expect(gravel.odometerKm).toBe(950); // 800 baseline + 150
    expect(gravel.components).toEqual([]);

    expect(joined.components.map((c) => c.id)).toEqual(['chain']);
  });

  it('a part installed at that derived figure starts its interval exactly at zero', async () => {
    const joined = roadOf(await q.loadBikesWithComponents());

    const wear = q.computeWear(joined.components[0], joined.odometerKm);
    expect(wear).toMatchObject({ usedKm: 0, pct: 0, status: 'aman', leftKm: 4000 });
  });

  it('deleting a ride moves the joined figure — through the production join, not a rollback', async () => {
    const before = roadOf(await q.loadBikesWithComponents());
    expect(before.odometerKm).toBe(4412);

    // the Rides page deletes the row; nothing else in the app touches the bike
    const idx = heap.activities.findIndex((a) => (a as { id?: string }).id === 'r2');
    heap.activities.splice(idx, 1);

    const after = roadOf(await q.loadBikesWithComponents());
    expect(after.rideKm).toBe(300);
    expect(after.odometerKm).toBe(4300); // down by exactly the deleted ride's 112 km

    // the clock never spent those kilometres, so it floors at zero rather than going negative
    const wear = q.computeWear(after.components[0], after.odometerKm);
    expect(wear).toMatchObject({ usedKm: 0, status: 'aman', leftKm: 4000 });

    // restore for the tests that follow (the store emission above was per call)
    heap.activities.splice(idx, 0, {
      id: 'r2', date: '2026-09-04T06:00:00', name: 'r2', source: 'strava', bikeId: 'road',
      distanceKm: 112, movingSec: 3600, elapsedSec: 3600, updatedAt: 1
    });
  });
});

describe('the service clock follows the ride table (computeWear over derived odometer)', () => {
  /** The component under test: a chain on road, default install at 4412, interval 4000. */
  const chain = (over: Partial<BikeComponent> = {}): BikeComponent => ({
    id: 'c1',
    bikeId: 'road',
    name: 'Chain',
    kind: 'chain',
    installedAtOdoKm: 4412,
    intervalKm: 4000,
    updatedAt: 1,
    ...over
  });

  /** Wear for rides attributed to `road`, re-derived from the ride rows on every call. */
  const wearFor = (
    rides: Array<{ bikeId?: string; distanceKm: number }>,
    opts: { comp?: Partial<BikeComponent>; baseline?: number } = {}
  ) => {
    const sums = sumRideKmByBike(rides);
    const odo = derivedOdometerKm(opts.baseline ?? 4000, sums.get('road') ?? 0);
    return q.computeWear(chain(opts.comp), odo);
  };

  it('only rides after the install point count toward the interval', () => {
    // 412 km were in history when the chain went on: that is the install point, not use
    expect(wearFor([{ bikeId: 'road', distanceKm: 300 }, { bikeId: 'road', distanceKm: 112 }]))
      .toMatchObject({ usedKm: 0, status: 'aman' });

    const after = wearFor([
      { bikeId: 'road', distanceKm: 300 },
      { bikeId: 'road', distanceKm: 112 },
      { bikeId: 'road', distanceKm: 400 }
    ]);
    expect(after).toMatchObject({ usedKm: 400, status: 'aman', leftKm: 3600 });
    expect(after.pct).toBeCloseTo(0.1, 6);
  });

  it('deleting a ride pays its kilometres back — the status steps down with it', () => {
    // install 4412 against a 4000 interval: 8412 of odometer is exactly due
    expect(wearFor([{ bikeId: 'road', distanceKm: 4370 }, { bikeId: 'road', distanceKm: 42 }]))
      .toMatchObject({ usedKm: 4000, pct: 1, status: 'kritis', leftKm: 0 });

    // delete the 42 km ride: real kilometre for kilometre, no rollback code anywhere
    const after = wearFor([{ bikeId: 'road', distanceKm: 4370 }]);
    expect(after).toMatchObject({ usedKm: 3958, status: 'waspada', leftKm: 42 });
  });

  it('a re-sync overwriting the same rows changes nothing (idempotent on write)', () => {
    const rides = [
      { bikeId: 'road', distanceKm: 4370, updatedAt: 1 },
      { bikeId: 'road', distanceKm: 42, updatedAt: 1 }
    ];
    const before = wearFor(rides);

    // the sync's overwrite: same ids and distances, newer stamp
    const resynced = rides.map((r) => ({ ...r, updatedAt: 999 }));
    const after = wearFor(resynced);

    expect({ usedKm: after.usedKm, pct: after.pct, status: after.status, leftKm: after.leftKm }).toEqual({
      usedKm: before.usedKm,
      pct: before.pct,
      status: before.status,
      leftKm: before.leftKm
    });
  });

  it('a ride with no bike advances no clock', () => {
    const attributed = [{ bikeId: 'road', distanceKm: 412 }, { bikeId: 'road', distanceKm: 400 }];
    const before = wearFor(attributed);

    // ...plus a 999 km walk that was never attributed to a machine
    const sums = sumRideKmByBike([...attributed, { distanceKm: 999 }]);
    expect([...sums.keys()]).toEqual(['road']);

    const after = wearFor([...attributed, { distanceKm: 999 }]);
    expect(after.usedKm).toBe(before.usedKm);
  });

  it('marks the UI-SPEC thresholds off the derived figure: 90 % WASPADA, 100 % KRITIS', () => {
    const use = (km: number) => wearFor([{ bikeId: 'road', distanceKm: km }], {
      baseline: 1000,
      comp: { installedAtOdoKm: 1000, intervalKm: 1000 }
    });

    expect(use(890)).toMatchObject({ status: 'aman' });
    expect(use(900)).toMatchObject({ status: 'waspada', leftKm: 100 });
    expect(use(1000)).toMatchObject({ status: 'kritis', leftKm: 0 });

    // display cap at 150 % — a long-overdue part is not unbounded
    expect(use(1500).pct).toBe(1.5);
    expect(use(2500).pct).toBe(1.5);

    // odometer below the install point (baseline corrected down) floors at zero used
    expect(wearFor([], { baseline: 800, comp: { installedAtOdoKm: 1000, intervalKm: 1000 } }))
      .toMatchObject({ usedKm: 0, pct: 0, status: 'aman', leftKm: 1000 });
  });

  it('servicing a part at the current derived odometer restarts its clock (Gear.service)', async () => {
    const joined = roadOf(await q.loadBikesWithComponents());
    const comp = joined.components[0];

    // Gear.svelte `service()` writes lastServiceAtOdoKm = the derived odometer on screen;
    // installedAtOdoKm (the provenance) never moves
    const serviced: Partial<BikeComponent> = { lastServiceAtOdoKm: joined.odometerKm };
    expect(q.computeWear({ ...comp, ...serviced }, joined.odometerKm))
      .toMatchObject({ usedKm: 0, status: 'aman', leftKm: 4000 });

    // a 5 km spin later: only that spin counts — the 412 km predating the service do not
    const later = wearFor(
      [
        { bikeId: 'road', distanceKm: 300 },
        { bikeId: 'road', distanceKm: 112 },
        { bikeId: 'road', distanceKm: 5 }
      ],
      { comp: { installedAtOdoKm: 4412, lastServiceAtOdoKm: 4412 } }
    );
    expect(later).toMatchObject({ usedKm: 5, status: 'aman' });
  });

  it('the service clock survives only until the next service — the install point never moves', () => {
    // a chain installed at 4412, relubed twice on a 300 km cadence
    const afterFirstLube = wearFor(
      [{ bikeId: 'road', distanceKm: 412 }, { bikeId: 'road', distanceKm: 300 }],
      { comp: { installedAtOdoKm: 4412, lastServiceAtOdoKm: 4712, intervalKm: 300 } }
    );
    expect(afterFirstLube).toMatchObject({ usedKm: 0, leftKm: 300 });
    // (odo is 4712 — exactly the service point, so the new lube cycle opens at zero)

    // 200 km of riding later, the clock has moved — and the install record has not
    const ridden = wearFor(
      [{ bikeId: 'road', distanceKm: 412 }, { bikeId: 'road', distanceKm: 500 }],
      { comp: { installedAtOdoKm: 4412, lastServiceAtOdoKm: 4712, intervalKm: 300 } }
    );
    expect(ridden).toMatchObject({ usedKm: 200, leftKm: 100 });
    expect(ridden.comp.installedAtOdoKm).toBe(4412); // provenance intact
  });

  it('a row that predates the service field counts from its install point (no migration)', () => {
    // stored before lastServiceAtOdoKm existed: the fallback is the install point,
    // which is exactly what the old computeWear did — existing riders see no change
    const legacy = wearFor(
      [{ bikeId: 'road', distanceKm: 412 }, { bikeId: 'road', distanceKm: 500 }],
      { comp: { installedAtOdoKm: 4412 } }
    );
    expect(legacy).toMatchObject({ usedKm: 500 });
  });
});