import type { ActivitySource } from '../data/db';

/**
 * GPX / TCX course parser — PRD F1-AC1, ROADMAP M1.
 *
 * Distance, elevation gain and moving time are all derived from the file: nothing is
 * assumed. Lives in the domain layer (not inside a component) so it can be unit-tested
 * against real fixture files instead of only being exercised through the import button.
 *
 * Edge cases that matter in practice:
 *  - Pauses are detected as timestamp gaps > 90 s and excluded from moving time.
 *  - Files without timestamps get a nominal pace fallback instead of a zero-duration ride.
 *  - Missing coordinates or elevation never poison the running totals: each channel is
 *    tracked independently, so a point without <ele> does not break the distance chain.
 */

export interface TrackPoint {
  /** epoch ms */
  t?: number;
  lat?: number;
  lng?: number;
  /** metres above sea level */
  alt?: number;
  /** rider power, watts — from TCX `<Watts>` or GPX `<gpxtpx:Watts>` */
  watts?: number;
  /** heart rate, bpm — TCX `<HeartRateBpm><Value>` or GPX `<gpxtpx:hr>` */
  hr?: number;
  /** cadence, rpm — TCX `<Cadence>` or GPX `<gpxtpx:cad>` */
  cad?: number;
}

export interface ParsedCourse {
  name: string;
  source: ActivitySource;
  /** ISO datetime */
  dateIso: string;
  distanceKm: number;
  /** moving seconds, pauses excluded */
  movingSec: number;
  /** total elevation gain in metres (uphill only) */
  elevGainM: number;
  points: TrackPoint[];
}

/** Timestamp gaps above this are a pause, not riding. */
export const PAUSE_GAP_SEC = 90;

/** Fallback speed (km/h) used when a file carries no usable timestamps. */
const NOMINAL_SPEED_KMH = 26;

function num(s: string | null | undefined): number {
  if (s == null) return NaN;
  const v = Number.parseFloat(s);
  return Number.isFinite(v) ? v : NaN;
}

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Parse a GPX or TCX document. Throws with a human-readable reason on unusable input. */
export function parseCourse(text: string, fileName: string): ParsedCourse {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Unreadable XML');

  const isTcx = doc.querySelector('TrainingCenterDatabase') !== null;
  const nodes = isTcx ? [...doc.querySelectorAll('Trackpoint')] : [...doc.querySelectorAll('trkpt')];
  if (nodes.length < 2) throw new Error('No trackpoints found');

  // Power, heart rate and cadence ride along inside the file and used to be dropped on
  // the floor: a TCX from a head unit carries `<ns3:Watts>` at every trackpoint, and a
  // Garmin GPX carries the same value as `<gpxtpx:Watts>` inside a TrackPointExtension.
  //
  // These are matched by *local name* rather than by CSS selector, because the vendor
  // prefix varies (`ns3:`, `gpxtpx:`) and a type selector that ignores namespaces is
  // not reliably implemented. XML is case-sensitive, so an exact local-name comparison
  // is both correct and vendor-agnostic.
  //
  // This mattered because the app looked correct while throwing the data away: the
  // honest empty state rendered in place of NP/TSS, so a broken import read as a rider
  // who simply has no power meter.
  const readSensors = (n: Element): Pick<TrackPoint, 'watts' | 'hr' | 'cad'> => {
    const out: { watts?: number; hr?: number; cad?: number } = {};
    for (const el of n.getElementsByTagName('*')) {
      const v = num(el.textContent);
      if (!Number.isFinite(v)) continue;
      switch (el.localName) {
        case 'Watts':
        case 'power':
          if (out.watts === undefined) out.watts = v;
          break;
        case 'HeartRateBpm':
        case 'hr':
          if (out.hr === undefined) out.hr = v;
          break;
        case 'Cadence':
        case 'cad':
          if (out.cad === undefined) out.cad = v;
          break;
      }
    }
    return out;
  };

  const points: TrackPoint[] = [];
  let distM = 0;
  let elevGain = 0;
  let prevLat = NaN;
  let prevLng = NaN;
  let prevAlt = NaN;

  for (const n of nodes) {
    const lat = isTcx
      ? num(n.querySelector('LatitudeDegrees')?.textContent)
      : num(n.getAttribute('lat'));
    const lng = isTcx
      ? num(n.querySelector('LongitudeDegrees')?.textContent)
      : num(n.getAttribute('lon'));
    const alt = isTcx ? num(n.querySelector('AltitudeMeters')?.textContent) : num(n.querySelector('ele')?.textContent);
    const tIso = n.querySelector('Time')?.textContent ?? undefined;
    const t = tIso ? Date.parse(tIso) : NaN;

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      if (Number.isFinite(prevLat) && Number.isFinite(prevLng)) distM += haversineM(prevLat, prevLng, lat, lng);
      prevLat = lat;
      prevLng = lng;
    }
    if (Number.isFinite(alt)) {
      // uphill only: a noisy barometer must not inflate the gain with its descent
      if (Number.isFinite(prevAlt) && alt > prevAlt) elevGain += alt - prevAlt;
      prevAlt = alt;
    }

    const p: TrackPoint = {};
    if (Number.isFinite(t)) p.t = t;
    if (Number.isFinite(lat)) p.lat = lat;
    if (Number.isFinite(lng)) p.lng = lng;
    if (Number.isFinite(alt)) p.alt = alt;
    // Sensor fields are only written when present. A sensor paired halfway through a
    // ride means the first points have no watts at all — emitting `watts: NaN` there
    // would make the stream look like a meter that read zero for the first hour.
    Object.assign(p, readSensors(n));
    points.push(p);
  }

  const times = points.map((p) => p.t).filter((t): t is number => t !== undefined);
  let movingSec = 0;
  for (let i = 1; i < times.length; i++) {
    const dt = (times[i] - times[i - 1]) / 1000;
    if (dt > 0 && dt <= PAUSE_GAP_SEC) movingSec += dt;
  }

  const distanceKm = distM / 1000;
  if (movingSec === 0) movingSec = Math.round((distanceKm / NOMINAL_SPEED_KMH) * 3600);

  // XML is case-sensitive and the two formats disagree: GPX writes `<name>`, TCX writes
  // `<Name>`. Asking only for the lowercase one meant every TCX ride was named after its
  // file instead of after the ride, which is how this bug stayed invisible.
  const name =
    doc.querySelector('name')?.textContent?.trim() ||
    doc.querySelector('Name')?.textContent?.trim() ||
    fileName.replace(/\.(gpx|tcx)$/i, '');
  const dateIso = times.length > 0 ? new Date(times[0]).toISOString() : new Date().toISOString();

  return {
    name,
    source: (isTcx ? 'tcx' : 'gpx') as ActivitySource,
    dateIso,
    distanceKm,
    movingSec,
    elevGainM: Math.round(elevGain),
    points
  };
}

/**
 * Thin a track down to at most `max` points for storage. Keeps the first and last point
 * so the stored shape still starts and ends where the ride did.
 */
export function decimateTrack<T>(points: readonly T[], max = 6000): T[] {
  if (points.length <= max) return [...points];
  const stride = Math.ceil(points.length / max);
  const out = points.filter((_, i) => i % stride === 0);
  if (out.at(-1) !== points.at(-1)) out.push(points.at(-1)!);
  return out;
}