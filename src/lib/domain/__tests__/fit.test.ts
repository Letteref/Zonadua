import { describe, expect, it } from 'vitest';
import { parseFit, isFitFile, FitParseError } from '../fit';

/**
 * Build a minimal but spec-shaped FIT file inside the test, so the parser is exercised
 * against real binary framing — header, definition messages, little-endian multi-byte
 * fields, invalid-value sentinels — rather than against a hand-waved fake.
 */

const FIT_EPOCH_OFFSET = 631065600;

function fitTime(ms: number): number {
  return Math.floor(ms / 1000) - FIT_EPOCH_OFFSET;
}

/** Little-endian byte writer with just the primitives the fixture needs. */
class Bin {
  private bytes: number[] = [];
  u8(v: number): this { this.bytes.push(v & 0xff); return this; }
  u16(v: number): this { return this.u8(v).u8(v >> 8); }
  u32(v: number): this { return this.u16(v & 0xffff).u16((v >>> 16) & 0xffff); }
  f32(v: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    for (const x of b) this.bytes.push(x);
    return this;
  }
  raw(...bs: (number | number[] | Uint8Array)[]): this {
    for (const b of bs) {
      if (typeof b === 'number') this.bytes.push(b);
      else for (const x of b) this.bytes.push(x);
    }
    return this;
  }
  get length(): number { return this.bytes.length; }
  out(): Uint8Array { return new Uint8Array(this.bytes); }
}

interface FieldSpec { num: number; size: number; type: number }

function definitionFrame(localType: number, globalMesg: number, fields: FieldSpec[]): Uint8Array {
  const b = new Bin();
  b.u8(0x40 | localType); // definition header
  b.u8(0); // reserved
  b.u8(1); // architecture: little-endian
  b.u16(globalMesg);
  b.u8(fields.length);
  for (const f of fields) b.raw(f.num, f.size, f.type);
  return b.out();
}

function recordFrame(fields: FieldSpec[], values: (number | undefined)[]): Uint8Array {
  const b = new Bin();
  for (let i = 0; i < fields.length; i++) {
    const size = fields[i].size;
    const v = values[i];
    if (v === undefined) {
      // write the type's invalid sentinel
      const inv = fields[i].type === 0x86 ? 0xffffffff : fields[i].type === 0x84 ? 0xffff : 0xff;
      for (let k = 0; k < size; k++) b.u8((inv >> (8 * k)) & 0xff);
    } else {
      for (let k = 0; k < size; k++) b.u8((Math.round(v) >> (8 * k)) & 0xff);
    }
  }
  return b.out();
}

const BT_UINT16 = 0x84;
const BT_UINT32 = 0x86;
const BT_UINT8 = 0x02;
const BT_ENUM = 0x00;

function wrap(payload: Uint8Array): Uint8Array {
  // 14-byte FIT header: size(1) + protocol ver(1) + profile ver(2) + data size(4)
  // + ".FIT"(4) + CRC(2) — the signature lands at offset 8, where the parser looks.
  const header = new Bin();
  header.u8(14).u8(0x10).u16(2110).u32(payload.length);
  header.raw(0x2e, 0x46, 0x49, 0x54); // ".FIT"
  header.u16(0); // header CRC (parser does not check it)
  const merged = new Uint8Array(header.length + payload.length + 2);
  merged.set(header.out(), 0);
  merged.set(payload, header.length);
  merged.set(new Bin().u16(0).out(), header.length + payload.length); // trailing data CRC
  return merged;
}

const START_MS = Date.UTC(2026, 8, 20, 6, 0, 0); // 20 Sept 2026, 06:00 UTC

function sampleFile(): Uint8Array {
  const payload = new Bin();

  // file id: time created
  payload.raw([...definitionFrame(0, 0, [{ num: 4, size: 4, type: BT_UINT32 }])]);
  payload.u8(0); // local type 0 data frame header
  payload.raw([...recordFrame([{ num: 4, size: 4, type: BT_UINT32 }], [fitTime(START_MS)])]);

  // record: timestamp, lat, lng, alt(enhanced), hr, cad, power
  const recFields: FieldSpec[] = [
    { num: 253, size: 4, type: BT_UINT32 }, // timestamp
    { num: 0, size: 4, type: BT_SINT32 }, // lat
    { num: 1, size: 4, type: BT_SINT32 }, // lng
    { num: 54, size: 4, type: BT_UINT32 }, // enhanced altitude
    { num: 3, size: 1, type: BT_UINT8 }, // hr
    { num: 4, size: 1, type: BT_UINT8 }, // cadence
    { num: 7, size: 2, type: BT_UINT16 } // power
  ];
  payload.raw([...definitionFrame(1, 20, recFields)]);

  const lat0 = -6.2;
  const lng0 = 106.8;
  const SEMI = 2 ** 31 / 180;
  const secs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const wattsSeries = [150, 180, 200, 250, 300, 280, 220, 190, 210, 230];
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i];
    const lat = lat0 + i * 0.0001;
    const lng = lng0 + i * 0.0001;
    const alt = 50 + i * 2; // gentle climb: total gain 18 m
    payload.u8(0x01 | 1); // data frame header, local type 1 (bit7 not set → SD record)
    payload.raw([
      ...recordFrame(recFields, [
        fitTime(START_MS) + s,
        Math.round(lat * SEMI),
        Math.round(lng * SEMI),
        alt, // enhanced altitude is plain metres
        120 + i, // hr
        80, // cadence
        wattsSeries[i]
      ])
    ]);
  }

  // session: start time, sport=cycling(2), total distance, timer, elapsed, ascent
  const sessFields: FieldSpec[] = [
    { num: 2, size: 4, type: BT_UINT32 },
    { num: 5, size: 1, type: BT_ENUM },
    { num: 9, size: 4, type: BT_UINT32 },
    { num: 8, size: 4, type: BT_UINT32 },
    { num: 7, size: 4, type: BT_UINT32 },
    { num: 22, size: 2, type: BT_UINT16 }
  ];
  payload.raw([...definitionFrame(2, 18, sessFields)]);
  payload.u8(0x02);
  payload.raw([
    ...recordFrame(sessFields, [
      fitTime(START_MS),
      2, // cycling
      4_200_00, // 4200.00 m → scale 100
      10_000, // timer ms → 10 s
      10_000, // elapsed ms
      18 // ascent m
    ])
  ]);

  return wrap(payload.out());
}

// SINT32 isn't in the fixture helpers above; declare it for the record fields.
const BT_SINT32 = 0x85;

describe('parseFit', () => {
  it('recognises a FIT file by its .FIT signature', () => {
    expect(isFitFile(sampleFile())).toBe(true);
    expect(isFitFile(new TextEncoder().encode('<gpx></gpx>'))).toBe(false);
  });

  it('decodes records: watts, gps, altitude, hr, cadence and timestamps', () => {
    const fit = parseFit(sampleFile(), 'morning.fit');
    expect(fit.points).toHaveLength(10);
    const first = fit.points[0];
    expect(first.watts).toBe(150);
    expect(first.hr).toBe(120);
    expect(first.cad).toBe(80);
    expect(first.lat).toBeCloseTo(-6.2, 4);
    expect(first.lng).toBeCloseTo(106.8, 4);
    expect(first.alt).toBeCloseTo(50, 1);
    expect(fit.points[9].watts).toBe(230);
    expect(fit.points[9].alt).toBeCloseTo(68, 1);
    // timestamps decode to the FIT epoch correctly
    expect(fit.points[0].t).toBe(START_MS);
    expect(fit.points[9].t).toBe(START_MS + 9_000);
  });

  it('reads session totals: distance, timer time, ascent, sport', () => {
    const fit = parseFit(sampleFile(), 'morning.fit');
    expect(fit.distanceM).toBeCloseTo(4200, 0);
    expect(fit.totalTimerSec).toBe(10);
    expect(fit.totalAscentM).toBe(18);
    expect(fit.sport).toBe('cycling');
    expect(fit.dateIso.slice(0, 4)).toBe('2026');
  });

  it('falls back to file-id time when the session lacks a start', () => {
    expect(parseFit(sampleFile(), 'x.fit').dateIso).toContain('2026-09-20');
  });

  it('rejects non-FIT bytes with a readable error', () => {
    expect(() => parseFit(new TextEncoder().encode('not a fit file at all'), 'bad.fit')).toThrow(FitParseError);
  });

  it('names the ride after the file', () => {
    expect(parseFit(sampleFile(), 'Sunday Climb.fit').name).toBe('Sunday Climb');
  });
});
