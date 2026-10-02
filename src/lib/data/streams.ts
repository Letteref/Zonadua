import type { ActivityStreams } from './db';

/**
 * Stream codec — the compressed `activity_streams` blob format (ARCHITECTURE.md §4).
 *
 * Stored payload: `deflate-raw` of a JSON array of sample objects, with `fields` holding
 * the keys of the first sample so readers can decode without guessing.
 *
 * Pure JSON + CompressionStream, no library: the same format is written by the GPX/TCX
 * importer and by the seeder, so both stay readable by the same decoder.
 */

export interface StreamSample {
  t?: number;
  lat?: number;
  lng?: number;
  alt?: number;
  watts?: number;
  hr?: number;
  cad?: number;
}

export async function deflateJson(data: unknown): Promise<Uint8Array> {
  const json = JSON.stringify(data);
  if (typeof CompressionStream === 'undefined') return new TextEncoder().encode(json);
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function inflateJson(bytes: Uint8Array): Promise<unknown> {
  // Legacy/plain rows were written without CompressionStream available.
  if (typeof DecompressionStream === 'undefined') return JSON.parse(new TextDecoder().decode(bytes));
  // Copy into a plain ArrayBuffer: Dexie hands back a view over a possibly shared one,
  // which BlobPart rejects.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}

/** Decode a stored stream row into sample objects. Returns [] on corrupt payloads. */
export async function decodeStream(row: ActivityStreams | undefined): Promise<StreamSample[]> {
  if (!row) return [];
  try {
    const parsed = await inflateJson(row.compressed);
    return Array.isArray(parsed) ? (parsed as StreamSample[]) : [];
  } catch (err) {
    console.error('[gowslab] stream decode failed:', err);
    return [];
  }
}

/** Encode samples into a stream row ready for `db.activity_streams.put`. */
export async function encodeStream(
  id: string,
  samples: StreamSample[],
  source: ActivityStreams['source'],
  /** set only for generator-made traces, so they can be invalidated without risk */
  synthVersion?: number
): Promise<ActivityStreams> {
  return {
    id,
    compressed: await deflateJson(samples),
    fields: Object.keys(samples[0] ?? {}),
    source,
    synthVersion,
    updatedAt: Date.now()
  };
}

export interface PowerTrace {
  watts: number[];
  /** seconds between samples */
  sampleSec: number;
}

const POWER_FIELDS = ['watts', 'power', 'power_watts'];

/**
 * Pull a power series out of decoded samples.
 *
 * GPX files carry no power, so importers legitimately produce traces with zero watt
 * samples — callers must treat `watts.length === 0` as "metrics unavailable", never
 * as "0 watts ridden".
 */
export function extractPower(samples: readonly StreamSample[]): PowerTrace | null {
  const key = POWER_FIELDS.find((f) => samples.some((s) => typeof s[f as 'watts'] === 'number'));
  if (!key) return null;

  const watts: number[] = [];
  const times: number[] = [];
  for (const s of samples) {
    const w = s[key as 'watts'];
    if (typeof w !== 'number' || !Number.isFinite(w)) continue;
    watts.push(w);
    if (typeof s.t === 'number') times.push(s.t);
  }
  if (watts.length === 0) return null;

  // Median sampling interval guards against a single timestamp gap skewing the rate.
  let sampleSec = 1;
  if (times.length >= 3) {
    const deltas: number[] = [];
    for (let i = 1; i < times.length; i++) {
      const dt = (times[i] - times[i - 1]) / 1000;
      if (dt > 0 && dt <= 30) deltas.push(dt);
    }
    if (deltas.length > 0) {
      deltas.sort((a, b) => a - b);
      sampleSec = deltas[Math.floor(deltas.length / 2)];
    }
  }

  return { watts, sampleSec };
}