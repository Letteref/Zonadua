import { db } from '$lib/data/db';
import { newId } from '$lib/data/seed';
import { haversineM, parseCourse } from '$lib/domain/course';
import type { ProfilePoint } from '$lib/domain/physics';
import { bearingBetween } from '$lib/domain/wind';

/**
 * GPX import, in one place.
 *
 * Two screens import a route file: the Routes estimator (which then *rides* the profile)
 * and the Route library (which only stores it). Both need the identical parse →
 * distance/gain → `[km, alt]` compression → Dexie write, and two copies of that pipeline
 * would drift exactly where correctness lives: the bearing-before-overwrite ordering and
 * the point-count bound. So this module owns the pipeline and returns everything either
 * caller needs, including the decoded profile for the session.
 */
export interface ImportedRoute {
  id: string;
  name: string;
  distanceKm: number;
  elevGainM: number;
  /** full-resolution `[km, alt]` pairs — what the physics consumes this session */
  points: Array<[number, number]>;
  /** chart-ready sample, ≤ ~600 points, same bound the estimator has always used */
  sampled: ProfilePoint[];
  /**
   * The first real fix — the honest location for a weather forecast. Null on a file
   * without coordinates (a forecast for a guessed hill is worse than none).
   */
  coords: { lat: number; lng: number } | null;
  /**
   * The first valid bearing, taken from consecutive fixes while walking the track.
   *
   * Computed *before* prevLat/prevLng are overwritten: reading it afterwards compares
   * each point with itself, which `bearingBetween` correctly reports as no direction at
   * all, and the estimator then silently stays on manual with no way for the rider to
   * tell why.
   */
  bearingDeg: number | null;
}

/** Bound the rendered point count; the stored track keeps full resolution. */
const MAX_SAMPLED = 600;

/**
 * Parse a GPX/TCX course file, store it as a `db.routes` row, and hand back the decoded
 * profile. Throws on anything the domain parser refuses — the caller reports it; this
 * module never invents a partial route.
 */
export async function parseAndStoreRoute(file: File): Promise<ImportedRoute> {
  // the tested domain parser owns distance, gain and the point list
  const ride = parseCourse(await file.text(), file.name);
  if (ride.distanceKm < 0.1) throw new Error('Route too short');

  // build the km/alt profile the physics actually consumes
  const xy: Array<[number, number]> = [];
  let distM = 0;
  let prevLat = NaN;
  let prevLng = NaN;
  let prevAlt = NaN;
  let coords: { lat: number; lng: number } | null = null;
  let bearingDeg: number | null = null;
  for (const p of ride.points) {
    if (p.lat != null && p.lng != null) {
      const havePrev = Number.isFinite(prevLat) && Number.isFinite(prevLng);
      if (bearingDeg == null && havePrev) {
        const b = bearingBetween(prevLat, prevLng, p.lat, p.lng);
        if (b != null) bearingDeg = b;
      }
      if (havePrev) distM += haversineM(prevLat, prevLng, p.lat, p.lng);
      prevLat = p.lat;
      prevLng = p.lng;
      // keep the first real fix so the weather forecast has an honest location; the
      // compressed profile deliberately carries only km/alt, so this is the only point
      // at which the route's coordinates still exist
      if (!coords) coords = { lat: p.lat, lng: p.lng };
    }
    if (p.alt != null) prevAlt = p.alt;
    xy.push([distM / 1000, prevAlt]);
  }

  const stride = Math.ceil(xy.length / MAX_SAMPLED); // bound the rendered point count
  const sampled = xy
    .filter((_, i) => i % stride === 0 || i === xy.length - 1)
    .map(([km, alt]) => ({ distKm: km, altM: alt }));

  if (typeof CompressionStream === 'undefined') throw new Error('Compression unsupported');
  const stream = new Blob([JSON.stringify(xy)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());

  const id = newId();
  await db.routes.put({
    id,
    name: ride.name,
    distanceKm: ride.distanceKm,
    elevGainM: ride.elevGainM,
    pointsCompressed: compressed,
    pointCount: xy.length,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  return { id, name: ride.name, distanceKm: ride.distanceKm, elevGainM: ride.elevGainM, points: xy, sampled, coords, bearingDeg };
}
