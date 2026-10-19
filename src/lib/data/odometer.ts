/**
 * Derived odometer (PRD F3) — the bike's total distance as a *function of the ride
 * history*, not a counter beside it.
 *
 * ## Why the counter went away
 *
 * `bikes.odometerKm` used to be incremented by the file importer and (later) the Strava
 * sync. Two failure modes followed from every increment: deleting a ride left the counter
 * too high forever, and a re-pull credited the same kilometres twice unless every write
 * site remembered its own guard. A counter only stays correct if *every* path that adds a
 * ride also adjusts it — and the paths that add rides are exactly the ones that keep
 * growing (import, sync, restore, seed).
 *
 * The derived form has neither problem. `odometer(bike) = baselineKm + Σ distanceKm of
 * activities attributed to it` is recomputed from the table on every read, so:
 *
 *  - deleting a ride reduces the odometer by exactly that ride — no rollback code,
 *  - a re-sync that overwrites rows in place changes nothing (same sum),
 *  - a restore, a seed, a manual row — any writer that produces activities produces a
 *    correct odometer without knowing the concept exists.
 *
 * ## The two terms
 *
 * `baselineKm` is the distance that is *not* in the activity table: the odometer reading
 * when the rider started tracking, typed by hand in the Gear form (or converted from the
 * old counter by the v3 migration). It is frozen history — nothing recomputes it.
 *
 * `Σ distanceKm by bikeId` is everything the app has actually seen. Attribution lives on
 * the activity row (`bikeId`), which is the field every writer already sets — the
 * importer sets it, the sync now sets it, the seeder sets it.
 *
 * ## Formulas, kept honest by unit tests (odometer.test.ts)
 *
 * - `derivedOdometerKm(baseline, rideKm)` — the read path.
 * - `baselineForTotal(typedTotal, rideKm)` — the Gear form: the rider types the *total*
 *   they see on the machine (or want shown), the form stores the baseline underneath it.
 *   The typed total is clamped ≥ 0; the baseline deliberately may go negative when the
 *   rider types less than the tracked rides sum, because the number they typed is the
 *   number they must see.
 * - `legacyBaseline(odometerKm, rideKm)` — conversion used by the schema-v3 migration
 *   and by backup restore: the old counter already contains those rides, so the baseline
 *   is whatever makes `baseline + Σ` land on the old displayed value. The result is
 *   negative exactly when the old counter was below its own ride sum — preserved, not
 *   clamped, or the displayed total would jump at migration.
 */

/** Sum `distanceKm` per `bikeId`; rides without a bike belong to no odometer. */
export function sumRideKmByBike(activities: ReadonlyArray<{ bikeId?: string; distanceKm?: number }>): Map<string, number> {
  const sums = new Map<string, number>();
  for (const a of activities) {
    if (!a.bikeId) continue;
    const km = Number(a.distanceKm);
    if (!Number.isFinite(km)) continue;
    sums.set(a.bikeId, (sums.get(a.bikeId) ?? 0) + km);
  }
  return sums;
}

/** The figure shown on the Gear page: frozen baseline plus every attributed ride. */
export function derivedOdometerKm(baselineKm: number | undefined, rideKm: number): number {
  return (baselineKm ?? 0) + rideKm;
}

/**
 * What to store when the rider types the odometer *total* they want displayed.
 *
 * Negative results are allowed (and preserved by the caller): a rider who corrects the
 * total down below their tracked sum still sees the total they typed.
 */
export function baselineForTotal(typedTotalKm: number, rideKm: number): number {
  return typedTotalKm - rideKm;
}

/**
 * Convert the old increment counter into a baseline without moving the displayed value:
 * `legacy + rideKm === old counter`, so a rider's number survives the migration bit for
 * bit. Un-clamped on purpose — see the module doc.
 */
export function legacyBaseline(odometerKm: number | undefined, rideKm: number): number {
  return (odometerKm ?? 0) - rideKm;
}

/**
 * Schema-v3 migration, as a pure function (unit-tested without Dexie).
 *
 * Two jobs, in this order:
 *
 * 1. **Attribute the rides the old counter already counted.** A row carrying
 *    `odometerCreditedAt` had its kilometres added to the increment counter, but only the
 *    row's own `bikeId` survives as attribution — and the old sync credited without
 *    setting one. Those rides move onto the active bike (the same machine the credit
 *    went to), so their kilometres live in the *sum* from here on instead of being
 *    frozen inside the baseline. Deleting one of them now reduces the odometer.
 *    Rows *without* the stamp are deliberately left alone: a pre-credit Strava ride was
 *    never in any counter, and attributing it now would raise the displayed total by its
 *    distance — the odometer would grow during an upgrade for a ride years old.
 * 2. **Freeze each bike's baseline** so the displayed figure does not move by a single
 *    kilometre: `baseline = counter − Σ(km attributed to this bike, after step 1)`.
 *
 * Bikes and activities are returned as the rows to write; the caller (the Dexie upgrade
 * hook) performs no arithmetic of its own.
 */
export function migrateOdometerToBaseline<B extends { id: string; active?: boolean; baselineKm?: number; odometerKm?: number }, A extends { bikeId?: string; distanceKm?: number; odometerCreditedAt?: number }>(
  bikes: readonly B[],
  activities: readonly A[],
  isCycling: (a: A) => boolean
): { bikes: B[]; activities: A[] } {
  const activeId = bikes.find((b) => b.active)?.id ?? bikes[0]?.id;

  const reattributed: A[] = [];
  for (const a of activities) {
    if (a.bikeId !== undefined) continue; // already attributed — its km are in the counter via import
    if (a.odometerCreditedAt === undefined) continue; // never counted — leave it that way
    if (!(Number(a.distanceKm) > 0) || !isCycling(a)) continue;
    if (!activeId) continue; // no machine to place it on: the credit died with the deleted bike, as it always had
    reattributed.push({ ...a, bikeId: activeId });
  }

  const sums = sumRideKmByBike([...activities, ...reattributed]);
  const migratedBikes = bikes.map((b) => {
    const next = { ...b, baselineKm: b.baselineKm ?? legacyBaseline(b.odometerKm, sums.get(b.id) ?? 0) } as B;
    delete next.odometerKm;
    return next;
  });

  return { bikes: migratedBikes, activities: reattributed };
}

/**
 * Normalise bike rows arriving from a pre-v3 backup file (`restoreBackupRows` accepts
 * older generations on purpose — see backup.ts).
 *
 * The old file carries the counter and no baseline; writing it as-is would display
 * `Σ rides` alone, collapsing a rider's 8 000 km machine to its tracked subset. The
 * baseline is frozen from *the file's own* rides so the restored figure matches the
 * exported one. Merged rides the device holds beyond the file add on top — an
 * approximation inherent to the old format, which recorded no per-ride attribution for
 * its counter, documented rather than pretended away.
 */
export function normalizeRestoredBikes<T extends { id: string; baselineKm?: number; odometerKm?: number }>(
  bikes: readonly T[],
  fileActivities: ReadonlyArray<{ bikeId?: string; distanceKm?: number }>
): T[] {
  const sums = sumRideKmByBike(fileActivities);
  return bikes.map((b) => {
    if (b.baselineKm !== undefined || b.odometerKm === undefined) return b;
    const next = { ...b, baselineKm: legacyBaseline(b.odometerKm, sums.get(b.id) ?? 0) } as T;
    delete next.odometerKm;
    return next;
  });
}
