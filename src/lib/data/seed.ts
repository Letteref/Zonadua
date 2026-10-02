import type {
  Athlete,
  Bike,
  BikeComponent,
  Settings,
  WeightLog,
  Activity,
  ActivityStreams
} from './db';
import { db } from './db';
import { METRICS_VERSION, ftpOnDate, rideMetrics } from '../domain/metrics';
import { SYNTH_SAMPLE_SEC, SYNTH_VERSION, synthPowerTrace } from './synthetic';
import { encodeStream, extractPower } from './streams';
import { backfillMetrics } from './recompute';

export function newId(): string {
  return crypto.randomUUID();
}

const dayIso = (offsetDays: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10);
};

export async function ensureSeeded(): Promise<void> {
  await db.open();

  const athlete = await db.athlete.get('me');
  if (!athlete) {
    const a: Athlete = {
      id: 'me',
      name: 'Andi',
      sex: 'm',
      birthDate: '1991-05-14',
      heightCm: 174,
      restingHr: 48,
      maxHr: 186,
      updatedAt: Date.now()
    };
    await db.athlete.put(a);
  }

  const settings = await db.settings.get('app');
  if (!settings) {
    const s: Settings = {
      id: 'app',
      unit: 'metric',
      theme: 'dark',
      lang: 'en',
      weatherOn: true,
      updatedAt: Date.now()
    };
    await db.settings.put(s);
  }

  const bikes = await db.bikes.count();
  if (bikes === 0) {
    const road: Bike = {
      id: newId(),
      name: 'Domane SL6',
      type: 'road',
      weightKg: 9.4,
      crr: 0.0045,
      cda: 0.32,
      odometerKm: 8412,
      active: true,
      notes: 'Shimano 105 Di2 · 32/28 cassette',
      updatedAt: Date.now()
    };
    const gravel: Bike = {
      id: newId(),
      name: 'Grizl',
      type: 'gravel',
      weightKg: 10.2,
      crr: 0.0068,
      cda: 0.38,
      odometerKm: 3190,
      active: false,
      notes: 'Canyon Grizl CF SL 7 · 45mm Pirelli Cinturato',
      updatedAt: Date.now()
    };
    await db.bikes.bulkPut([road, gravel]);

    const comps: BikeComponent[] = [
      {
        id: newId(),
        bikeId: road.id,
        name: 'Chain',
        kind: 'chain',
        installedAtOdoKm: 4412,
        intervalKm: 4000,
        updatedAt: Date.now()
      },
      {
        id: newId(),
        bikeId: road.id,
        name: 'Brake Pads (F/R)',
        kind: 'brake-pads',
        installedAtOdoKm: 5562,
        intervalKm: 3500,
        updatedAt: Date.now()
      },
      {
        id: newId(),
        bikeId: road.id,
        name: 'GP5000 S TR Tires',
        kind: 'tires',
        installedAtOdoKm: 1920,
        intervalKm: 4500,
        updatedAt: Date.now()
      },
      {
        id: newId(),
        bikeId: road.id,
        name: 'Cassette 11-34T',
        kind: 'cassette',
        installedAtOdoKm: 4412,
        intervalKm: 8000,
        updatedAt: Date.now()
      }
    ];
    await db.components.bulkPut(comps);
  }

  const weights = await db.weight_log.count();
  if (weights === 0) {
    // Gentle downward trend 69.8 → 68.2 over 12 weeks
    const logs: WeightLog[] = [];
    for (let w = 11; w >= 0; w--) {
      logs.push({
        id: newId(),
        date: dayIso(w * 7),
        kg: Math.round((69.8 - (11 - w) * 0.145) * 10) / 10,
        updatedAt: Date.now()
      });
    }
    await db.weight_log.bulkPut(logs);
  }

  const ftps = await db.ftp_history.count();
  if (ftps === 0) {
    // Denser than the minimum so that ftpOnDate() actually resolves two different
    // values across the seeded 6-week block (M2: FTP is date-dependent).
    await db.ftp_history.bulkPut([
      { id: newId(), date: dayIso(300), ftp: 258, updatedAt: Date.now() },
      { id: newId(), date: dayIso(150), ftp: 266, updatedAt: Date.now() },
      { id: newId(), date: dayIso(60), ftp: 272, updatedAt: Date.now() },
      { id: newId(), date: dayIso(14), ftp: 275, updatedAt: Date.now() }
    ]);
  }

  const acts = await db.activities.count();
  if (acts === 0) {
    const roadBike = await db.bikes.where('name').equals('Domane SL6').first();
    const ftpHistory = await db.ftp_history.orderBy('date').toArray();
    const acts2: Activity[] = [];
    const streamRows: ActivityStreams[] = [];
    // 6 weeks, ~4 rides/week, building TSS
    for (let w = 5; w >= 0; w--) {
      const base = 210 - w * 12;
      const plan: Array<[number, number, number, boolean]> = [
        [42 + w * 1.5, 5400 + w * 240, base + 20, false], // long ride
        [28, 5100, base - 25, false], // intervals
        [22, 4200, base - 45, true], // commute
        [32 + w, 6300, base, false] // endurance
      ];
      for (let i = 0; i < plan.length; i++) {
        const [dist, secs, targetNp, commute] = plan[i];
        const name =
          i === 0
            ? 'Sunday Long Ride'
            : i === 1
              ? 'Threshold Intervals'
              : i === 2
                ? 'Commute'
                : 'Endurance Spin';
        const id = newId();
        const date = dayIso(w * 7 + i * 1 + 1) + 'T06:30:00';
        const source = (i % 2 === 0 ? 'strava' : 'gpx') as Activity['source'];

        // Power first, metrics second: NP/IF/TSS are derived from this trace,
        // never assumed (ARCHITECTURE.md §5.1).
        const samples = synthPowerTrace({ id, name, movingSec: secs, targetNp });
        const trace = extractPower(samples)!;
        const ftp = ftpOnDate(ftpHistory, date);
        const m = rideMetrics(trace.watts, ftp, SYNTH_SAMPLE_SEC, secs);

        acts2.push({
          id,
          date,
          name,
          source,
          bikeId: commute ? undefined : roadBike?.id,
          distanceKm: dist,
          movingSec: secs,
          elapsedSec: secs + 900,
          elevGainM: Math.round(dist * (i === 0 ? 16 : 7)),
          avgPower: m.avgPower,
          np: Math.round(m.np),
          if: Math.round(m.if * 100) / 100,
          tss: Math.round(m.tss),
          avgHr: 138 + (i === 1 ? 14 : 0),
          maxHr: 168 + (i === 1 ? 8 : 0),
          kcal: Math.round(m.kcal),
          commute,
          synthetic: true,
          mVersion: METRICS_VERSION,
          updatedAt: Date.now()
        });
        streamRows.push(await encodeStream(id, samples, source, SYNTH_VERSION));
      }
    }
    await db.transaction('rw', [db.activities, db.activity_streams], async () => {
      await db.activities.bulkPut(acts2);
      await db.activity_streams.bulkPut(streamRows);
    });
  }

  // M2: upgrade any stored np/if/tss that predates the metrics pipeline — including the
  // fabricated demo rows written before NP became computable (see lib/data/recompute.ts).
  await backfillMetrics();
}
