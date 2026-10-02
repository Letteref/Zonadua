/**
 * Power zones — F2-AC4 (PRD §F2) and F1 distribution view.
 *
 * Bands live in the domain so the same definition serves the activity detail, the coach
 * context, and the zone editor. A stored `zones` record overrides them per athlete.
 *
 * Bands are stored as *stops* (a lower bound each) rather than as independent ranges:
 * the upper bound is always the next stop's lower bound. That makes overlapping or
 * gapped bands impossible, so no power value can ever fall outside every band and get
 * silently dropped from the distribution.
 */

export interface ZoneStop {
  /** stable id, e.g. Z2 — survives renames so history stays comparable */
  key: string;
  name: string;
  /** inclusive lower bound as % of FTP */
  minPct: number;
}

export interface ZoneBand {
  key: string;
  name: string;
  /** inclusive lower bound as % of FTP */
  minPct: number;
  /** exclusive upper bound as % of FTP; Infinity for the top band */
  maxPct: number;
}

export interface ZoneTemplate {
  id: string;
  name: string;
  note: string;
  stops: readonly ZoneStop[];
}

/** The classic 8-band Coggan model, used as the default. */
export const DEFAULT_ZONE_STOPS: readonly ZoneStop[] = Object.freeze([
  { key: 'Z0', name: 'Recovery', minPct: 0 },
  { key: 'Z1', name: 'Endurance', minPct: 55 },
  { key: 'Z2', name: 'Tempo', minPct: 75 },
  { key: 'Z3', name: 'Sweet spot', minPct: 90 },
  { key: 'Z4', name: 'Threshold', minPct: 105 },
  { key: 'Z5', name: 'VO₂ max', minPct: 120 },
  { key: 'Z6', name: 'Anaerobic', minPct: 150 },
  { key: 'Z7', name: 'Neuromuscular', minPct: 180 }
]);

export const ZONE_TEMPLATES: readonly ZoneTemplate[] = Object.freeze([
  {
    id: 'coggan8',
    name: 'Coggan 8-zone',
    note: 'Most granular. Recovery separated from endurance, top two bands split out.',
    stops: DEFAULT_ZONE_STOPS
  },
  {
    id: 'coggan5',
    name: 'Coggan 5-zone',
    note: 'The classic: everything under 55% is lumped into one easy zone.',
    stops: [
      { key: 'Z1', name: 'Endurance', minPct: 0 },
      { key: 'Z2', name: 'Tempo', minPct: 55 },
      { key: 'Z3', name: 'Sweet spot', minPct: 75 },
      { key: 'Z4', name: 'Threshold', minPct: 90 },
      { key: 'Z5', name: 'VO₂ max', minPct: 110 }
    ]
  },
  {
    id: 'coggan3',
    name: 'Coggan 3-zone',
    note: 'Coarse polarised model: easy / moderate / hard.',
    stops: [
      { key: 'Z1', name: 'Endurance', minPct: 0 },
      { key: 'Z2', name: 'Tempo', minPct: 76 },
      { key: 'Z3', name: 'Threshold', minPct: 90 }
    ]
  }
]);

/** Expand stops into contiguous bands (upper bound = next stop's lower bound). */
export function bandsFromStops(stops: readonly ZoneStop[]): ZoneBand[] {
  const sorted = [...stops].sort((a, b) => a.minPct - b.minPct);
  return sorted.map((s, i) => ({
    key: s.key,
    name: s.name,
    minPct: s.minPct,
    maxPct: i + 1 < sorted.length ? sorted[i + 1].minPct : Infinity
  }));
}

/** Convert a stored `zones.zones` array (name/min/max) back into editable stops. */
export function stopsFromBands(
  bands: readonly { name: string; min?: number; max?: number }[]
): ZoneStop[] {
  return bands.map((b, i) => ({
    key: `Z${i}`,
    name: b.name,
    minPct: Number.isFinite(b.min) ? (b.min as number) : 0
  }));
}

/**
 * Validate an edited zone list.
 * Lower bounds must be strictly ascending and the first must sit at 0, otherwise power
 * below the first stop would never be counted.
 */
export function validateStops(stops: readonly ZoneStop[]): { ok: boolean; reason?: string } {
  if (stops.length === 0) return { ok: false, reason: 'At least one zone is required' };
  if (stops.length > 10) return { ok: false, reason: 'Ten zones is the upper limit' };
  if (stops.some((s) => !s.name.trim())) return { ok: false, reason: 'Every zone needs a name' };
  if (stops.some((s) => !Number.isFinite(s.minPct) || s.minPct < 0)) {
    return { ok: false, reason: 'Lower bounds must be zero or greater' };
  }
  const sorted = [...stops].sort((a, b) => a.minPct - b.minPct);
  if (sorted[0].minPct !== 0) return { ok: false, reason: 'The first zone must start at 0%' };
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].minPct === sorted[i - 1].minPct) {
      return { ok: false, reason: `Two zones share the ${sorted[i].minPct}% boundary` };
    }
  }
  return { ok: true };
}

export const DEFAULT_POWER_ZONES: readonly ZoneBand[] = bandsFromStops(DEFAULT_ZONE_STOPS);

export interface ZoneTime {
  band: ZoneBand;
  /** lower bound in watts, for the current FTP */
  minWatts: number;
  sec: number;
  /** share of total sampled time, 0–100 */
  pct: number;
}

export interface ZoneDistribution {
  zones: ZoneTime[];
  totalSec: number;
  /** mean power across the trace (W) */
  avgPower: number;
}

/** Which band a power falls into. Returns undefined for unknown boundaries. */
export function zoneOfPower(
  watts: number,
  ftp: number,
  bands: readonly ZoneBand[] = DEFAULT_POWER_ZONES
): ZoneBand | undefined {
  if (ftp <= 0 || !Number.isFinite(watts)) return undefined;
  const pct = (watts / ftp) * 100;
  return bands.find((b) => pct >= b.minPct && pct < b.maxPct);
}

/**
 * Time in each zone across a power trace.
 *
 * Percentages are shares of *sampled* time, not of moving time from the file — a paused
 * GPX import has no samples at all, so there is nothing to distribute.
 */
export function zoneDistribution(
  watts: readonly number[],
  ftp: number,
  sampleSec = 1,
  bands: readonly ZoneBand[] = DEFAULT_POWER_ZONES
): ZoneDistribution {
  const counts = new Map<string, number>();
  let sum = 0;

  for (const raw of watts) {
    const w = Number.isFinite(raw) && raw > 0 ? raw : 0;
    sum += w;
    const band = zoneOfPower(w, ftp, bands);
    if (band) counts.set(band.key, (counts.get(band.key) ?? 0) + 1);
  }

  const totalSec = watts.length * sampleSec;
  const zones: ZoneTime[] = bands.map((band) => {
    const sec = (counts.get(band.key) ?? 0) * sampleSec;
    return {
      band,
      minWatts: Math.round((band.minPct / 100) * ftp),
      sec,
      pct: totalSec > 0 ? Math.round((sec / totalSec) * 1000) / 10 : 0
    };
  });

  return {
    zones,
    totalSec,
    avgPower: watts.length > 0 ? Math.round(sum / watts.length) : 0
  };
}

/** Zones worth calling out on a ride: everything from Sweet spot upward. */
export function intensityZones(d: ZoneDistribution): ZoneTime[] {
  return d.zones.filter((z) => z.band.minPct >= 90);
}

/** Fraction of the ride spent at Sweet spot or harder, 0–100. */
export function highIntensityShare(d: ZoneDistribution): number {
  return Math.round(d.zones.filter((z) => z.band.minPct >= 90).reduce((a, z) => a + z.pct, 0) * 10) / 10;
}

export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  // below a minute, seconds are the only meaningful unit — "00m" hides real time
  if (sec < 60) return `${Math.round(sec)}s`;

  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  const mm = m === 60 ? 0 : m;
  const hh = m === 60 ? h + 1 : h;
  if (hh === 0) return `${String(mm).padStart(2, '0')}m`;
  return `${hh}h ${String(mm).padStart(2, '0')}m`;
}