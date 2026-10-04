import { METRICS_VERSION, ftpOnDate, rideMetrics } from '../domain/metrics';
import { CURVE_VERSION, meanMaxPower } from '../domain/power-curve';
import { db } from './db';
import { SYNTH_SAMPLE_SEC, SYNTH_VERSION, synthPowerTrace } from './synthetic';
import { decodeStream, encodeStream, extractPower } from './streams';

/**
 * Derived-data backfill — keeps stored numbers honest on every launch.
 *
 * Three jobs:
 *  1. Recompute np/if/tss when the metrics pipeline version changed.
 *  2. Give *demo* rides that have no power stream a synthetic trace and compute from it.
 *     Only rows the seeder produced can be in this state, so this upgrades old fabricated
 *     demo data. It deliberately does not fire for a real ride that arrived without a
 *     stream — see `shouldSynthesiseTrace` for why the "it can only be demo data" argument
 *     is true of the importer and false of the table.
 *  3. Compute the mean-max power curve for every activity that carries power.
 *
 * Rides imported from GPX/TCX have no power at all and are deliberately left without
 * np/if/tss or a curve — an honest "not measurable" beats an invented number.
 */

/**
 * May this row be given a synthetic power trace?
 *
 * Extracted from `backfillMetrics` so the rule can be tested without IndexedDB, because
 * the rule is the part worth being sure about: a fabricated trace attached to a ride the
 * rider believes is their own is the worst thing this file could do.
 *
 * ## Why only `synthetic` rows qualify
 *
 * This used to fire for any row with `np` set and no stream, on the argument that "only
 * the seeder produces that state, because the GPX/TCX importer never writes `np`". That is
 * true of the importer and false of the table. Restore merges whatever tables a backup
 * file happens to carry, and it explicitly accepts legacy `gowslab` payloads written before
 * `activity_streams` existed — so a real ride can arrive with `np`, a `strava` source and
 * no stream. The old rule gave that row a generated trace, recomputed its metrics from it,
 * and left the provenance badge saying Strava. Nothing in the UI said those numbers were
 * invented.
 *
 * A genuine ride that lost its stream now keeps the numbers it was stored with and is
 * counted as `noPower`, so it shows up as an activity without a derived curve instead of
 * as one carrying measurements that were never made.
 *
 * @param hasTrace whether a real power stream was decoded for this row
 */
export function shouldSynthesiseTrace(
  act: { synthetic?: boolean; np?: number | null },
  hasTrace: boolean,
  synthVersion?: number
): boolean {
  const staleSynth = synthVersion !== undefined && synthVersion !== SYNTH_VERSION;
  return (!hasTrace && act.synthetic === true) || staleSynth;
}

export interface BackfillResult {
  scanned: number;
  recomputed: number;
  curvesComputed: number;
  tracesGenerated: number;
  /** rows with no power available in any form — derived metrics stay absent */
  noPower: number;
}

export async function backfillMetrics(): Promise<BackfillResult> {
  const result: BackfillResult = {
    scanned: 0,
    recomputed: 0,
    curvesComputed: 0,
    tracesGenerated: 0,
    noPower: 0
  };

  const [activities, streams, curves, ftpHistory] = await Promise.all([
    db.activities.toArray(),
    db.activity_streams.toArray(),
    db.power_curves.toArray(),
    db.ftp_history.orderBy('date').toArray()
  ]);
  if (activities.length === 0) return result;

  const streamById = new Map(streams.map((s) => [s.id, s]));
  const curveById = new Map(curves.map((c) => [c.activityId, c]));

  for (const act of activities) {
    result.scanned++;
    const row = streamById.get(act.id);
    const samples = await decodeStream(row);
    let trace = extractPower(samples);
    let generated = false;

    // Regenerate a synthetic trace when (a) there is none yet but the seeder wrote
    // metrics, or (b) the generator version moved on. Real rider streams carry no
    // synthVersion and are never regenerated.
    if (shouldSynthesiseTrace(act, trace !== null, row?.synthVersion)) {
      const synth = synthPowerTrace({
        id: act.id,
        name: act.name,
        movingSec: act.movingSec,
        targetNp: act.np ?? Math.round((act.avgPower ?? 0) * 1.05)
      });
      await db.activity_streams.put(await encodeStream(act.id, synth, act.source, SYNTH_VERSION));
      trace = extractPower(synth);
      generated = true;
      result.tracesGenerated++;
    }

    if (!trace) {
      result.noPower++;
      continue;
    }

    const needsMetrics = generated || act.mVersion !== METRICS_VERSION;
    const needsCurve = generated || curveById.get(act.id)?.version !== CURVE_VERSION;
    if (!needsMetrics && !needsCurve) continue;

    const sampleSec = trace.sampleSec || SYNTH_SAMPLE_SEC;

    if (needsMetrics) {
      const metrics = rideMetrics(trace.watts, ftpOnDate(ftpHistory, act.date), sampleSec, act.movingSec);
      await db.activities.update(act.id, {
        np: Math.round(metrics.np),
        if: Math.round(metrics.if * 100) / 100,
        tss: Math.round(metrics.tss),
        avgPower: metrics.avgPower,
        kcal: Math.round(metrics.kcal),
        mVersion: METRICS_VERSION
      });
      result.recomputed++;
    }

    if (needsCurve) {
      const points = meanMaxPower(trace.watts, sampleSec);
      if (points.length > 0) {
        await db.power_curves.put({
          id: act.id,
          activityId: act.id,
          points,
          version: CURVE_VERSION,
          updatedAt: Date.now()
        });
        result.curvesComputed++;
      }
    }
  }

  if (result.recomputed > 0 || result.curvesComputed > 0) {
    console.info(
      `[zonadua] backfill: ${result.recomputed} metrics recomputed, ${result.curvesComputed} curves, ${result.tracesGenerated} synthetic traces, ${result.noPower} without power`
    );
  }
  return result;
}

/**
 * Rescore every ride on/after a date against the FTP that is now in force.
 *
 * NP depends only on the power trace, so it is untouched — but IF and TSS are both
 * divided by FTP, which means logging a new FTP silently invalidates them for every
 * earlier ride under the old value. Returns how many rides were rescored.
 */
export async function recomputeSince(dateIso: string): Promise<number> {
  const day = dateIso.slice(0, 10);
  const [activities, streams, ftpHistory] = await Promise.all([
    db.activities.toArray(),
    db.activity_streams.toArray(),
    db.ftp_history.orderBy('date').toArray()
  ]);

  const streamById = new Map(streams.map((s) => [s.id, s]));
  const affected = activities.filter((a) => a.date.slice(0, 10) >= day);
  let updated = 0;

  for (const act of affected) {
    const trace = extractPower(await decodeStream(streamById.get(act.id)));
    if (!trace) continue;

    const ftp = ftpOnDate(ftpHistory, act.date);
    if (ftp <= 0) continue;
    // already scored against this FTP — nothing to do
    if (act.np != null && Math.abs((act.np / ftp) - (act.if ?? 0)) < 0.005) continue;

    const m = rideMetrics(trace.watts, ftp, trace.sampleSec, act.movingSec);
    await db.activities.update(act.id, {
      np: Math.round(m.np),
      if: Math.round(m.if * 100) / 100,
      tss: Math.round(m.tss),
      avgPower: m.avgPower,
      kcal: Math.round(m.kcal),
      mVersion: METRICS_VERSION
    });
    updated++;
  }

  if (updated > 0) console.info(`[zonadua] rescored ${updated} ride(s) against the new FTP`);
  return updated;
}