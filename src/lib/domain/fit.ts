/**
 * FIT binary parser — Garmin's Flexible and Interoperable Data Transfer format.
 *
 *
 * developer messages are skipped on sight rather than half-read.
 *
 * The parser is pure bytes → values, with no DOM and no fetch, so the same fixture bytes
 * exercise it in vitest and in the browser.
 */
import { PAUSE_GAP_SEC, haversineM, type ParsedCourse, type TrackPoint } from './course';
import type { ActivitySource } from '../data/db';

/** Compressed-timestamp record: top bit set, time rides in the low 5 bits of the header. */
const MESSAGE_HEADER_COMPRESSED_TS = 0x80;
/** Definition messages declare layouts; their local type is 0x40 + local number. */
const DEFINITION_HEADER_MASK = 0x60;
const DEFINITION_HEADER_FLAG = 0x40;

/** Global message numbers this app consumes. */
const MESG_FILE_ID = 0;
const MESG_RECORD = 20;
const MESG_LAP = 19;
const MESG_SESSION = 18;

/** Record message fields. */
const FIELD_TIMESTAMP = 253;
const FIELD_POSITION_LAT = 0;
const FIELD_POSITION_LNG = 1;
/** Semicycles per metre for lat/lng in the coordinate fields. */
const SEMICYCLES = 180 / 2 ** 31;
const FIELD_ALTITUDE = 2;
/** Enhanced altitude (field 54) and legacy altitude (field 2) use different scales. */
const FIELD_ENHANCED_ALTITUDE = 54;
const FIELD_SPEED = 6;
const FIELD_HEART_RATE = 3;
const FIELD_CADENCE = 4;
const FIELD_POWER = 7;

/** Session fields. */
const FIELD_SESSION_START_TIME = 2;
const FIELD_SESSION_SPORT = 5;
const FIELD_SESSION_TOTAL_DISTANCE = 9;
const FIELD_SESSION_TOTAL_ELAPSED = 7;
const FIELD_SESSION_TOTAL_TIMER = 8;
const FIELD_SESSION_TOTAL_ASCENT = 22;

/** Lap fields. */
const FIELD_LAP_START_TIME = 2;
const FIELD_LAP_TOTAL_TIMER = 7;

/** File id fields. */
const FIELD_FILE_ID_TIME_CREATED = 4;

export interface FitTrackPoint {
  t?: number;
  lat?: number;
  lng?: number;
  alt?: number;
  watts?: number;
  hr?: number;
  cad?: number;
}

export interface ParsedFit {
  name: string;
  dateIso: string;
  /** metres */
  distanceM: number;
  /** seconds of timer time (pauses excluded by the device) */
  totalTimerSec: number;
  /** seconds of elapsed time including pauses */
  totalElapsedSec: number;
  /** metres, uphill only, as the device recorded it */
  totalAscentM: number;
  points: FitTrackPoint[];
  /** sport word from the session message when present (`cycling`, `running`, …) */
  sport?: string;
}

export class FitParseError extends Error {}

/** Known fit global profiles for validation-ish error messages. */
const KNOWN_MESGS = new Set([MESG_FILE_ID, MESG_RECORD, MESG_LAP, MESG_SESSION, 140]);

export interface FitDataView {
  readSdl(): number;
}

function isFitHeader(buf: Uint8Array): boolean {
  return (
    buf.length > 14 &&
    buf[8] === 0x2e && // "."
    buf[9] === 0x46 && // "F"
    buf[10] === 0x49 && // "I"
    buf[11] === 0x54 // "T"
  );
}

export function isFitFile(buf: Uint8Array): boolean {
  return isFitHeader(buf);
}

/** Read one definition/record message pair stream, accumulating what we consume. */
export function parseFit(buf: Uint8Array, fileName = 'ride.fit'): ParsedFit {
  if (!isFitFile(buf)) throw new FitParseError('Not a FIT file (missing .FIT signature)');

  // Header: [0]=headerSize (usually 14, may be 12 on ancient files), [4..]=protocol.
  const headerSize = buf[0];
  let off = headerSize;

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Developer-data flag and definition-message architecture are per-message; we keep a
  // single map of local message number → layout, which is what the spec requires anyway.
  interface Definition {
    globalMesg: number;
    /** byte size of one record frame with this layout */
    size: number;
    fields: {
      num: number;
      size: number;
      /** FIT base type byte */
      type: number;
      /** 1 = little-endian multi-byte, 0 = big-endian */
      arch: 0 | 1;
    }[];
  }
  const defs = new Map<number, Definition>();

  const points: FitTrackPoint[] = [];
  let lastTimestamp: number | undefined; // FIT epoch seconds
  let lastTsRolloverBase = 0; // cumulative seconds above the 32 s window
  let lastCompressedTsByte = 0;
  let session: { start?: number; sport?: string; dist?: number; timer?: number; elapsed?: number; ascent?: number } = {};
  let lastLapStart: number | undefined;
  let fileIdTime: number | undefined;

  const FIT_EPOCH_OFFSET = 631065600; // seconds between 1970-01-01 and 1989-12-31

  function fitTimeToDate(fitSec: number): Date {
    return new Date((fitSec + FIT_EPOCH_OFFSET) * 1000);
  }

  // ---- base-type decoding -----------------------------------------------------
  const BT = {
    ENUM: 0x00,
    SINT8: 0x01,
    UINT8: 0x02,
    SINT16: 0x83,
    UINT16: 0x84,
    SINT32: 0x85,
    UINT32: 0x86,
    STRING: 0x07,
    FLOAT32: 0x88,
    FLOAT64: 0x89,
    UINT8Z: 0x0b,
    UINT16Z: 0x8c,
    UINT32Z: 0x8d,
    BYTE: 0x0a,
    SINT64: 0x8e,
    UINT64: 0x8f,
    UINT64Z: 0x90
  } as const;

  const INVALID = new Map<number, number>([
    [BT.ENUM, 0xff],
    [BT.SINT8, 0x7f],
    [BT.UINT8, 0xff],
    [BT.SINT16, 0x7fff],
    [BT.UINT16, 0xffff],
    [BT.SINT32, 0x7fffffff],
    [BT.UINT32, 0xffffffff],
    [BT.FLOAT32, 0xffffffff],
    [BT.FLOAT64, 0xffffffffffffffff]
  ]);

  function readField(dv: DataView, off: number, type: number, size: number, arch: 0 | 1): number | undefined {
    // Frame data can sit flush against the file's trailing CRC; a read that would cross
    // the buffer edge is a framing artefact, not a value, so clamp it to undefined.
    if (off < 0 || off + size > dv.byteLength) return undefined;
    const invalid = INVALID.get(type);
    switch (type) {
      case BT.UINT8:
      case BT.UINT8Z:
      case BT.ENUM:
      case BT.BYTE: {
        if (size < 1) return undefined;
        const v = dv.getUint8(off);
        return invalid !== undefined && v === invalid ? undefined : v;
      }
      case BT.SINT8: {
        const v = dv.getInt8(off);
        return v === 0x7f ? undefined : v;
      }
      case BT.UINT16:
      case BT.UINT16Z:
      case BT.SINT16: {
        if (size < 2) return undefined;
        const v = arch === 1 ? dv.getUint16(off, true) : dv.getUint16(off, false);
        const signed = type === BT.SINT16;
        return invalid !== undefined && v === invalid ? undefined : signed ? (v << 16) >> 16 : v;
      }
      case BT.UINT32:
      case BT.UINT32Z:
      case BT.SINT32: {
        if (size < 4) return undefined;
        const v = arch === 1 ? dv.getUint32(off, true) : dv.getUint32(off, false);
        if (invalid === v) return undefined;
        // SINT32 arrives as raw two's complement; positions (negative = south/west) rely on it.
        return type === BT.SINT32 ? v | 0 : v;
      }
      case BT.FLOAT32: {
        if (size < 4) return undefined;
        const v = dv.getFloat32(off, arch === 1);
        return Number.isFinite(v) ? v : undefined;
      }
      case BT.FLOAT64: {
        if (size < 8) return undefined;
        const v = dv.getFloat64(off, arch === 1);
        return Number.isFinite(v) ? v : undefined;
      }
      default:
        return undefined;
    }
  }

  // ---- message loop ------------------------------------------------------------
  while (off < buf.length) {
    const header = buf[off];
    if (header === undefined) break;

    if ((header & MESSAGE_HEADER_COMPRESSED_TS) !== 0 && (header & DEFINITION_HEADER_MASK) === 0) {
      // Compressed timestamp record: 1-byte header, local type in bits 5-6, timestamp in low 5 bits.
      const localType = (header >> 5) & 0x3;
      const def = defs.get(localType);
      off += 1;
      if (!def || def.globalMesg !== MESG_RECORD) continue; // still need to skip the frame
      const tsByte = header & 0x1f;
      if (tsByte < (lastCompressedTsByte & 0x1f)) lastTsRolloverBase += 32;
      lastCompressedTsByte = tsByte;
      lastTimestamp = lastTsRolloverBase + tsByte;
      // 1-byte frame: decode with the definition, no size to skip.
      decodeRecord(def, off, lastTimestamp);
      off += def.size;
      continue;
    }

    if ((header & DEFINITION_HEADER_FLAG) !== 0) {
      const isDeveloper = (header & 0x20) !== 0;
      const localType = header & 0x0f;
      // Frame: [header, reserved, architecture (1 = little-endian), global mesg num (u16)].
      const arch: 0 | 1 = buf[off + 2] === 1 ? 1 : 0;
      const globalMesg = arch === 1 ? dv.getUint16(off + 3, true) : dv.getUint16(off + 3, false);
      off += 5; // header byte + reserved + arch + 2 bytes global mesg
      const fieldCount = buf[off];
      off += 1;
      if (isDeveloper) off += 1; // developer data index
      const fields: Definition['fields'] = [];
      for (let i = 0; i < fieldCount; i++) {
        const fnum = buf[off];
        const fsize = buf[off + 1];
        // dev-data fields carry an extra byte we do not resolve; they are skipped by the
        // definition size below, which is what makes skipping safe.
        const ftype = buf[off + 2];
        off += 3;
        fields.push({ num: fnum, size: fsize, type: ftype, arch });
      }
      const size = fields.reduce((s, f) => s + f.size, 0);
      defs.set(localType, { globalMesg, size, fields });
      continue;
    }

    if ((header & 0x60) === 0) {
      // Data message: bits 5-6 clear, local type in bits 0-3, frame length = def.size.
      const localType = header & 0x0f;
      const def = defs.get(localType);
      off += 1;
      if (!def) continue; // unknown layout: cannot size the frame, but SD frames only
      // follow definitions we have read, so this is unreachable in well-formed files.
      // The trailing file CRC is not a message: an incomplete frame means we are done.
      if (off + def.size > buf.length) break;
      if (def.globalMesg === MESG_RECORD) {
        // timestamp field if present
        let ts: number | undefined = lastTimestamp;
        for (const f of def.fields) {
          if (f.num === FIELD_TIMESTAMP && f.size >= 4) {
            const v = readField(dv, off + fieldOffset(def, f), f.type, f.size, f.arch);
            if (v !== undefined) ts = v;
          }
        }
        decodeRecord(def, off, ts);
      } else if (def.globalMesg === MESG_SESSION) {
        decodeSession(def, off);
      } else if (def.globalMesg === MESG_LAP) {
        decodeLap(def, off);
      } else if (def.globalMesg === MESG_FILE_ID) {
        for (const f of def.fields) {
          if (f.num === FIELD_FILE_ID_TIME_CREATED && f.size >= 4) {
            const v = readField(dv, off + fieldOffset(def, f), f.type, f.size, f.arch);
            if (v !== undefined) fileIdTime = v;
          }
        }
      }
      off += def.size;
      continue;
    }

    // Anything else (unknown header patterns) — skip one byte and keep scanning rather
    // than give up on a file a device wrote with a feature we do not model.
    off += 1;
  }

  function fieldOffset(def: Definition, field: Definition['fields'][number]): number {
    let o = 0;
    for (const f of def.fields) {
      if (f === field) return o;
      o += f.size;
    }
    return o;
  }

  function decodeRecord(def: Definition, off: number, ts: number | undefined): void {
    const p: FitTrackPoint = {};
    for (const f of def.fields) {
      const v = readField(dv, off + fieldOffset(def, f), f.type, f.size, f.arch);
      if (v === undefined) continue;
      switch (f.num) {
        case FIELD_TIMESTAMP:
          lastTimestamp = v;
          p.t = fitTimeToDate(v).getTime();
          break;
        case FIELD_POSITION_LAT:
          p.lat = v * SEMICYCLES;
          break;
        case FIELD_POSITION_LNG:
          p.lng = v * SEMICYCLES;
          break;
        case FIELD_ENHANCED_ALTITUDE:
        case FIELD_ALTITUDE: {
          // legacy altitude is m + 500, enhanced altitude is plain metres
          const alt = f.num === FIELD_ALTITUDE ? v - 500 : v;
          if (alt > -1000 && alt < 12000) p.alt = alt;
          break;
        }
        case FIELD_SPEED:
          // m/s — but we keep the timestamp chain for moving time, so speed is unused.
          break;
        case FIELD_HEART_RATE:
          if (v > 0) p.hr = v;
          break;
        case FIELD_CADENCE:
          if (v > 0) p.cad = v;
          break;
        case FIELD_POWER:
          if (v > 0 && v < 8192) p.watts = v;
          break;
        default:
          break;
      }
    }
    // Records without a timestamp inherit the previous one so `t` never goes backwards
    // into undefined; the caller's decimation and pause logic read `t` unconditionally.
    if (p.t === undefined && ts !== undefined) p.t = fitTimeToDate(ts).getTime();
    points.push(p);
  }

  function decodeSession(def: Definition, off: number): void {
    for (const f of def.fields) {
      const v = readField(dv, off + fieldOffset(def, f), f.type, f.size, f.arch);
      if (v === undefined) continue;
      switch (f.num) {
        case FIELD_SESSION_START_TIME:
          session.start = v;
          break;
        case FIELD_SESSION_SPORT: {
          const s = sportName(v);
          if (s) session.sport = s;
          break;
        }
        case FIELD_SESSION_TOTAL_DISTANCE:
          // scale 100 → metres
          session.dist = v / 100;
          break;
        case FIELD_SESSION_TOTAL_ELAPSED:
          session.elapsed = v / 1000;
          break;
        case FIELD_SESSION_TOTAL_TIMER:
          session.timer = v / 1000;
          break;
        case FIELD_SESSION_TOTAL_ASCENT:
          session.ascent = v;
          break;
      }
    }
  }

  function decodeLap(def: Definition, off: number): void {
    for (const f of def.fields) {
      if (f.num === FIELD_LAP_START_TIME) {
        const v = readField(dv, off + fieldOffset(def, f), f.type, f.size, f.arch);
        if (v !== undefined) lastLapStart = v;
      } else if (f.num === FIELD_LAP_TOTAL_TIMER) {
        const v = readField(dv, off + fieldOffset(def, f), f.type, f.size, f.arch);
        if (v !== undefined && session.timer === undefined) session.timer = v / 1000;
      }
    }
  }

  // ---- assemble -----------------------------------------------------------------
  const usable = points.filter((p) => p.t !== undefined || p.watts !== undefined);
  if (usable.length < 2 && session.dist === undefined) {
    throw new FitParseError('No record messages decoded — file may be corrupted or use an unsupported profile');
  }

  // If the session never arrived (some files), derive distance from GPS.
  let distanceM = session.dist;
  if (distanceM === undefined) {
    let acc = 0;
    let prev: FitTrackPoint | undefined;
    for (const p of points) {
      if (p.lat === undefined || p.lng === undefined) continue;
      if (prev?.lat != null && prev.lng != null && isFinite(prev.lat) && isFinite(prev.lng) && isFinite(p.lat) && isFinite(p.lng)) acc += haversineM(prev.lat, prev.lng, p.lat, p.lng);
      prev = p;
    }
    distanceM = acc;
  }

  const startFit = session.start ?? lastLapStart ?? fileIdTime;
  const dateIso = startFit !== undefined
    ? fitTimeToDate(startFit).toISOString()
    : points.find((p) => p.t !== undefined)?.t !== undefined
      ? new Date(points.find((p) => p.t !== undefined)!.t!).toISOString()
      : new Date().toISOString();

  const totalTimerSec = session.timer ?? session.elapsed;
  if (totalTimerSec === undefined && usable.length < 2) {
    throw new FitParseError('No timing information found');
  }
  const totalElapsedSec = session.elapsed ?? totalTimerSec ?? 0;

  // Some profiles report sport as a byte into the FIT sport table; 11 is cycling, but the
  // table is long and mostly unused by head units, so unknown values stay undefined rather
  // than becoming a wrong label.
  void KNOWN_MESGS;

  return {
    name: fileName.replace(/\.fit$/i, ''),
    dateIso,
    distanceM: distanceM ?? 0,
    totalTimerSec: totalTimerSec ?? 0,
    totalElapsedSec,
    totalAscentM: session.ascent ?? 0,
    points,
    sport: session.sport
  };
}

/** FIT sport table, only the entries a head unit plausibly writes. */
function sportName(v: number): string | undefined {
  const table: Record<number, string> = {
    0: 'generic',
    1: 'running',
    2: 'cycling',
    5: 'swimming',
    6: 'rowing',
    11: 'hiking',
    15: 'skiing',
    26: 'training'
  };
  return table[v];
}

/**
 * Convert a parsed FIT file into the same shape the GPX/TCX import pipeline consumes,
 * so Rides.svelte has one code path for streams, metrics and DB writes. Device totals
 * (distance, timer time, ascent) win where present — a barometer and a wheel sensor
 * know the ride better than a haversine over decimated points — with the derived
 * values kept as fallback for files that only carry a record stream.
 */
export function fitToCourse(fit: ParsedFit): ParsedCourse {
  const points: TrackPoint[] = fit.points.map((p) => {
    const out: TrackPoint = {};
    if (p.t !== undefined) out.t = p.t;
    if (p.lat !== undefined) out.lat = p.lat;
    if (p.lng !== undefined) out.lng = p.lng;
    if (p.alt !== undefined) out.alt = p.alt;
    if (p.watts !== undefined) out.watts = p.watts;
    if (p.hr !== undefined) out.hr = p.hr;
    if (p.cad !== undefined) out.cad = p.cad;
    return out;
  });

  // Moving time from the record stream's own gaps, same rule as parseCourse — the
  // device's timer total is preferred below, but trainer files without a session
  // message still need a number here.
  const times = points.map((p) => p.t).filter((t): t is number => t !== undefined);
  let movingSec = 0;
  for (let i = 1; i < times.length; i++) {
    const dt = (times[i] - times[i - 1]) / 1000;
    if (dt > 0 && dt <= PAUSE_GAP_SEC) movingSec += dt;
  }
  if (fit.totalTimerSec > 0) movingSec = Math.round(fit.totalTimerSec);
  else if (movingSec === 0 && points.length > 1) {
    movingSec = points.length - 1; // 1 s sampling assumption, last resort
  }

  // Elevation gain from the decoded altitude channel when the session total is absent.
  let elevGainM = fit.totalAscentM;
  if (!elevGainM) {
    let prev: number | undefined;
    for (const p of points) {
      if (p.alt === undefined) continue;
      if (prev !== undefined && p.alt > prev) elevGainM += p.alt - prev;
      prev = p.alt;
    }
    elevGainM = Math.round(elevGainM);
  }

  const distanceKm = fit.distanceM > 0 ? fit.distanceM / 1000 : 0;

  return {
    name: fit.name,
    source: 'fit' as ActivitySource,
    dateIso: fit.dateIso,
    distanceKm,
    movingSec,
    elevGainM,
    points
  };
}
