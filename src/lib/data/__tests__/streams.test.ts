import { describe, expect, it, vi } from 'vitest';
import { rideMetrics } from '../../domain/metrics';
import { fitCriticalPower, meanMaxPower, mergePowerCurves } from '../../domain/power-curve';
import { decodeStream, deflateJson, encodeStream, extractPower, inflateJson } from '../streams';
import { SYNTH_SAMPLE_SEC, synthPowerTrace } from '../synthetic';

const samples = [
  { t: 0, watts: 150, hr: 120 },
  { t: 5000, watts: 210, hr: 138 },
  { t: 10000, watts: 180, hr: 130 }
];

describe('stream codec', () => {
  it('round-trips a payload through deflate-raw', async () => {
    const bytes = await deflateJson(samples);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(await inflateJson(bytes)).toEqual(samples);
  });

  it('records the sample field names on encode', async () => {
    const row = await encodeStream('ride-1', samples, 'gpx');
    expect(row.id).toBe('ride-1');
    expect(row.fields).toEqual(['t', 'watts', 'hr']);
    expect(await decodeStream(row)).toEqual(samples);
  });

  it('returns an empty array for a missing row', async () => {
    expect(await decodeStream(undefined)).toEqual([]);
  });

  it('returns an empty array instead of throwing on a corrupt payload', async () => {
    // the decoder logs on purpose — keep the expected error out of the test output
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const row = await encodeStream('ride-2', samples, 'gpx');
    row.compressed = new Uint8Array([1, 2, 3, 4, 5]);
    expect(await decodeStream(row)).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('survives an empty sample list', async () => {
    const row = await encodeStream('ride-3', [], 'manual');
    expect(row.fields).toEqual([]);
    expect(await decodeStream(row)).toEqual([]);
  });
});

describe('extractPower', () => {
  it('reads watts and the median sampling interval', () => {
    const trace = extractPower(samples);
    expect(trace).not.toBeNull();
    expect(trace!.watts).toEqual([150, 210, 180]);
    expect(trace!.sampleSec).toBe(5);
  });

  it('returns null when the file carries no power (GPX case)', () => {
    const gpx = [
      { t: 0, lat: 1, lng: 2, alt: 10 },
      { t: 1000, lat: 1.001, lng: 2.001, alt: 12 }
    ];
    expect(extractPower(gpx)).toBeNull();
  });

  it('returns null for an empty sample list', () => {
    expect(extractPower([])).toBeNull();
  });

  it('skips non-finite and missing watt readings', () => {
    const trace = extractPower([
      { t: 0, watts: 200 },
      { t: 1000 },
      { t: 2000, watts: Number.NaN },
      { t: 3000, watts: 250 }
    ]);
    expect(trace!.watts).toEqual([200, 250]);
  });

  it('ignores timestamp gaps longer than 30 s when inferring the rate', () => {
    const gappy = [
      { t: 0, watts: 100 },
      { t: 5000, watts: 100 },
      { t: 600000, watts: 100 }, // 10-minute gap — must not become the interval
      { t: 605000, watts: 100 }
    ];
    expect(extractPower(gappy)!.sampleSec).toBe(5);
  });
});

describe('synthPowerTrace', () => {
  const input = { id: 'ride-abc', name: 'Endurance Spin', movingSec: 3600, targetNp: 200 };

  it('is deterministic for the same id', () => {
    expect(synthPowerTrace(input)).toEqual(synthPowerTrace(input));
  });

  it('differs between activities', () => {
    expect(synthPowerTrace(input)).not.toEqual(synthPowerTrace({ ...input, id: 'ride-xyz' }));
  });

  it('emits samples at the declared interval across the whole ride', () => {
    const trace = synthPowerTrace(input);
    expect(trace).toHaveLength(3600 / SYNTH_SAMPLE_SEC);
    expect(trace[0].t).toBe(0);
    expect(trace.at(-1)!.t).toBe((trace.length - 1) * SYNTH_SAMPLE_SEC * 1000);
  });

  it('produces no negative power', () => {
    for (const s of synthPowerTrace({ ...input, name: 'Threshold Intervals', targetNp: 320 })) {
      expect(s.watts!).toBeGreaterThanOrEqual(0);
    }
  });

  it('lands NP on the requested target', () => {
    const trace = extractPower(synthPowerTrace(input))!;
    const m = rideMetrics(trace.watts, 275, trace.sampleSec, input.movingSec);
    // generator rounds to whole watts, so allow 2% drift
    expect(m.np).toBeGreaterThan(input.targetNp * 0.98);
    expect(m.np).toBeLessThan(input.targetNp * 1.02);
  });

  it('hits the target for interval sessions too', () => {
    const hard = { ...input, name: 'Threshold Intervals', targetNp: 320 };
    const trace = extractPower(synthPowerTrace(hard))!;
    expect(rideMetrics(trace.watts, 275, trace.sampleSec).np).toBeGreaterThan(319);
    expect(rideMetrics(trace.watts, 275, trace.sampleSec).np).toBeLessThan(321);
  });

  it('keeps the variability penalty: intervals score NP above mean power', () => {
    const npOf = (name: string): number => {
      const trace = extractPower(synthPowerTrace({ ...input, name }))!;
      return rideMetrics(trace.watts, 275, trace.sampleSec, input.movingSec).np;
    };
    const meanOf = (name: string): number => {
      const watts = extractPower(synthPowerTrace({ ...input, name }))!.watts;
      return watts.reduce((a, b) => a + b, 0) / watts.length;
    };

    // steady-ish riding: NP is essentially the mean power
    expect(npOf('Endurance Spin')).toBeGreaterThan(meanOf('Endurance Spin') * 0.98);
    // work/rest blocks: NP must sit clearly above the mean power
    expect(npOf('Threshold Intervals')).toBeGreaterThan(meanOf('Threshold Intervals') * 1.05);
  });

  it('never exceeds zero load for an impossible target', () => {
    const trace = extractPower(synthPowerTrace({ ...input, targetNp: 0 }))!;
    expect(rideMetrics(trace.watts, 0).tss).toBe(0);
  });
});

describe('synthetic rides form a physiologically coherent power curve', () => {
  const rides = [
    { name: 'Sunday Long Ride', movingSec: 6300, targetNp: 230 },
    { name: 'Threshold Intervals', movingSec: 5100, targetNp: 195 },
    { name: 'Endurance Spin', movingSec: 6300, targetNp: 200 },
    { name: 'Commute', movingSec: 4200, targetNp: 165 },
    { name: 'Sunday Long Ride', movingSec: 5400, targetNp: 222 }
  ];

  const merged = mergePowerCurves(
    rides.map((r, i) => {
      const trace = extractPower(synthPowerTrace({ id: `seed-${i}`, ...r }))!;
      return meanMaxPower(trace.watts, trace.sampleSec);
    })
  );

  it('drops monotonically as duration grows', () => {
    const watts = merged.map((p) => p.watts);
    for (let i = 1; i < watts.length; i++) {
      expect(watts[i]).toBeLessThanOrEqual(watts[i - 1]);
    }
  });

  it('starts high and settles toward critical power', () => {
    const at = (sec: number) => merged.find((p) => p.durationSec === sec)?.watts ?? 0;
    // every trace is scaled to its own target NP, so assert the *shape*: a steep drop
    // from a one-second spike to an hour of sustainable power
    expect(at(1)).toBeGreaterThan(at(3600) * 1.6);
    expect(at(60)).toBeGreaterThan(at(1800));
    expect(at(1800)).toBeGreaterThan(150);
    expect(at(3600)).toBeLessThan(340);
  });

  it('produces a curve the CP/W′ model can actually fit', () => {
    const fit = fitCriticalPower(merged)!;
    expect(fit).toBeDefined();
    // The merged curve is a best-of-many-efforts envelope, not one maximal test, so it
    // sits slightly above a single-rider CP curve at mid durations. Real merged curves
    // behave the same way; 0.9 is the honest floor for demo data.
    expect(fit.r2).toBeGreaterThan(0.9);
    expect(fit.cp).toBeGreaterThan(150);
    expect(fit.wPrime).toBeGreaterThan(0);
  });
});