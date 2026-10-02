// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { PAUSE_GAP_SEC, decimateTrack, haversineM, parseCourse } from '../course';
import { extractPower } from '../../data/streams';

/** Minimal GPX with N points on a straight line, optional elevation and timestamps. */
function gpx(opts: {
  points: number;
  stepLat?: number;
  stepLon?: number;
  startAlt?: number;
  altStep?: number;
  stepSec?: number;
  startTime?: string;
  withName?: string;
}): string {
  const {
    points,
    stepLat = 0.001,
    stepLon = 0.001,
    startAlt,
    altStep = 0,
    stepSec = 10,
    startTime = '2026-09-01T06:00:00Z',
    withName
  } = opts;
  const pts = Array.from({ length: points }, (_, i) => {
    const lat = -6.2 + i * stepLat;
    const lon = 106.8 + i * stepLon;
    const ele = startAlt == null ? '' : `<ele>${startAlt + i * altStep}</ele>`;
    const time = `<time>${new Date(Date.parse(startTime) + i * stepSec * 1000).toISOString()}</time>`;
    return `      <trkpt lat="${lat}" lon="${lon}">${ele}${time}</trkpt>`;
  }).join('\n');
  return `<?xml version="1.0"?>
<gpx version="1.1" creator="test"><metadata><name>${withName ?? ''}</name></metadata>
  <trk><name>${withName ?? ''}</name><trkseg>
${pts}
  </trkseg></trk></gpx>`;
}

describe('parseCourse — GPX', () => {
  it('computes distance, moving time and gain from the file', () => {
    const ride = parseCourse(gpx({ points: 10, startAlt: 100, altStep: 5 }), 'ride.gpx');
    // 9 legs × ~157.4 m (0.001° lat ≈ 111 m, 0.001° lon ≈ 111 m at this latitude)
    expect(ride.distanceKm).toBeGreaterThan(1.3);
    expect(ride.distanceKm).toBeLessThan(1.5);
    expect(ride.movingSec).toBe(9 * 10);
    expect(ride.elevGainM).toBe(9 * 5);
  });

  it('reads the name from the file, falling back to the filename', () => {
    expect(parseCourse(gpx({ points: 5, withName: 'Morning Loop' }), 'x.gpx').name).toBe('Morning Loop');
    expect(parseCourse(gpx({ points: 5 }), 'Saturday Ride.gpx').name).toBe('Saturday Ride');
  });

  it('tags the source as gpx and starts from the first timestamp', () => {
    const ride = parseCourse(gpx({ points: 5, startTime: '2026-09-01T06:00:00Z' }), 'x.gpx');
    expect(ride.source).toBe('gpx');
    expect(ride.dateIso).toBe('2026-09-01T06:00:00.000Z');
  });

  it('excludes pauses longer than the gap threshold from moving time', () => {
    // 3 points 10 s apart, then a 10-minute gap, then 3 more
    const doc = `<?xml version="1.0"?><gpx><trk><trkseg>
      <trkpt lat="0" lon="0"><time>2026-09-01T06:00:00Z</time></trkpt>
      <trkpt lat="0.001" lon="0"><time>2026-09-01T06:00:10Z</time></trkpt>
      <trkpt lat="0.002" lon="0"><time>2026-09-01T06:00:20Z</time></trkpt>
      <trkpt lat="0.003" lon="0"><time>2026-09-01T06:10:20Z</time></trkpt>
      <trkpt lat="0.004" lon="0"><time>2026-09-01T06:10:30Z</time></trkpt>
      <trkpt lat="0.005" lon="0"><time>2026-09-01T06:10:40Z</time></trkpt>
    </trkseg></trk></gpx>`;
    const ride = parseCourse(doc, 'paused.gpx');
    // five legs of 10/10/600/10/10 s — only the 600 s gap is a stop → 40 s moving
    expect(ride.movingSec).toBe(40);
  });

  it('counts only uphill metres as gain', () => {
    // 100 → 120 → 110: gain is 20, the descent does not subtract
    const ride = parseCourse(gpx({ points: 3, startAlt: 100, altStep: 0 }), 'flat.gpx');
    expect(ride.elevGainM).toBe(0);
  });

  it('falls back to a nominal pace when the file has no timestamps', () => {
    const noTime = `<?xml version="1.0"?><gpx><trk><trkseg>
      <trkpt lat="0" lon="0"/><trkpt lat="0.01" lon="0"/><trkpt lat="0.02" lon="0"/>
    </trkseg></trk></gpx>`;
    const ride = parseCourse(noTime, 'notime.gpx');
    expect(ride.movingSec).toBeGreaterThan(0);
    expect(ride.dateIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('keeps the distance chain intact when one point lacks coordinates', () => {
    const mixed = `<?xml version="1.0"?><gpx><trk><trkseg>
      <trkpt lat="0" lon="0"><ele>10</ele></trkpt>
      <trkpt lat="0.001" lon="0"><ele>20</ele></trkpt>
      <trkpt><ele>30</ele></trkpt>
      <trkpt lat="0.002" lon="0"><ele>40</ele></trkpt>
    </trkseg></trk></gpx>`;
    const ride = parseCourse(mixed, 'mixed.gpx');
    // distance spans the two usable legs, skipping the coordinate-less point
    expect(ride.distanceKm).toBeGreaterThan(0.2);
    expect(ride.points).toHaveLength(4);
    expect(ride.points[2].lat).toBeUndefined();
  });

  it('rejects unusable files with a readable reason', () => {
    expect(() => parseCourse('<not xml', 'broken.gpx')).toThrow(/Unreadable XML/);
    expect(() => parseCourse('<gpx><trk><trksec/></trk></gpx>', 'empty.gpx')).toThrow(
      /No trackpoints/
    );
  });

  it('rejects a single trackpoint', () => {
    expect(() => parseCourse('<gpx><trk><trkseg><trkpt lat="0" lon="0"/></trkseg></trk></gpx>', 'one.gpx')).toThrow(
      /No trackpoints/
    );
  });
});

describe('parseCourse — TCX', () => {
  const tcx = `<?xml version="1.0"?>
<TrainingCenterDatabase><Activities><Activity Sport="Biking">
  <Id>2026-09-02T07:00:00Z</Id>
  <Lap StartTime="2026-09-02T07:00:00Z"><Track>
    <Trackpoint>
      <Time>2026-09-02T07:00:00Z</Time>
      <Position><LatitudeDegrees>-6.2</LatitudeDegrees><LongitudeDegrees>106.8</LongitudeDegrees></Position>
      <AltitudeMeters>50</AltitudeMeters>
    </Trackpoint>
    <Trackpoint>
      <Time>2026-09-02T07:00:30Z</Time>
      <Position><LatitudeDegrees>-6.199</LatitudeDegrees><LongitudeDegrees>106.8</LongitudeDegrees></Position>
      <AltitudeMeters>90</AltitudeMeters>
    </Trackpoint>
  </Track></Lap>
</Activity></Activities></TrainingCenterDatabase>`;

  it('parses TCX position and altitude elements', () => {
    const ride = parseCourse(tcx, 'ride.tcx');
    expect(ride.source).toBe('tcx');
    expect(ride.movingSec).toBe(30);
    expect(ride.elevGainM).toBe(40);
    expect(ride.distanceKm).toBeGreaterThan(0.1);
  });

  it('falls back to the filename when TCX carries no name element', () => {
    expect(parseCourse(tcx, 'Hill Reps.tcx').name).toBe('Hill Reps');
  });

  it('reads a TCX <Name>, which is capitalised, unlike GPX <name>', () => {
    // Asking only for lowercase `name` meant every TCX ride was filed under its
    // filename — "e2e-power" instead of the ride the rider actually named.
    const named = tcx.replace('<Id>', '<Name>Tuesday Threshold</Name><Id>');
    expect(parseCourse(named, 'whatever.tcx').name).toBe('Tuesday Threshold');
  });

  it('reads watts, heart rate and cadence out of the trackpoint', () => {
    // The whole reason this test exists: the parser used to read position, altitude and
    // time and silently drop the sensor block, even though a TCX from a head unit puts
    // watts at every single trackpoint. Because the app then showed an honest empty
    // state for a ride with no power, the data loss looked like a rider with no meter.
    const withSensors = `<?xml version="1.0"?>
<TrainingCenterDatabase xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><Activities><Activity Sport="Biking">
  <Id>2026-09-02T07:00:00Z</Id>
  <Lap StartTime="2026-09-02T07:00:00Z"><Track>
    ${Array.from({ length: 6 }, (_, i) => {
      const watts = 210 + i * 10;
      return `<Trackpoint>
      <Time>${new Date(Date.parse('2026-09-02T07:00:00Z') + i * 10_000).toISOString()}</Time>
      <Position><LatitudeDegrees>-6.2</LatitudeDegrees><LongitudeDegrees>${106.8 + i * 0.001}</LongitudeDegrees></Position>
      <AltitudeMeters>${50 + i * 5}</AltitudeMeters>
      <HeartRateBpm><Value>${130 + i}</Value></HeartRateBpm>
      <Cadence>${85 + i}</Cadence>
      <Extensions><ns3:TPX><ns3:Watts>${watts}</ns3:Watts></ns3:TPX></Extensions>
    </Trackpoint>`;
    }).join('\n    ')}
  </Track></Lap>
</Activity></Activities></TrainingCenterDatabase>`;

    const ride = parseCourse(withSensors, 'sensor.tcx');
    expect(ride.points).toHaveLength(6);
    expect(ride.points.map((p) => p.watts)).toEqual([210, 220, 230, 240, 250, 260]);
    expect(ride.points.map((p) => p.hr)).toEqual([130, 131, 132, 133, 134, 135]);
    expect(ride.points.map((p) => p.cad)).toEqual([85, 86, 87, 88, 89, 90]);

    // And the decoded stream must actually yield a power series, which is the whole
    // point — this is the call the importer makes.
    expect(extractPower(ride.points)?.watts).toEqual([210, 220, 230, 240, 250, 260]);
  });

  it('leaves watts absent when the sensor paired mid-ride, rather than writing zero', () => {
    // Zero watts means "coasting"; missing means "no reading". A meter that connects at
    // kilometre 20 must not look like a rider who coasted the first 20 km.
    const halfSensors = `<?xml version="1.0"?>
<TrainingCenterDatabase><Activities><Activity Sport="Biking">
  <Lap StartTime="2026-09-02T07:00:00Z"><Track>
    ${Array.from({ length: 4 }, (_, i) => {
      const watts = i < 2 ? '' : `<Watts>${250 + i}</Watts>`;
      return `<Trackpoint>
      <Time>${new Date(Date.parse('2026-09-02T07:00:00Z') + i * 10_000).toISOString()}</Time>
      <Position><LatitudeDegrees>-6.2</LatitudeDegrees><LongitudeDegrees>${106.8 + i * 0.001}</LongitudeDegrees></Position>
      ${watts}
    </Trackpoint>`;
    }).join('\n    ')}
  </Track></Lap>
</Activity></Activities></TrainingCenterDatabase>`;

    const ride = parseCourse(halfSensors, 'late.tcx');
    expect(ride.points[0].watts).toBeUndefined();
    expect(ride.points[1].watts).toBeUndefined();
    expect(ride.points[2].watts).toBe(252);
    // The decoder must still find the samples that do exist.
    expect(extractPower(ride.points)?.watts).toEqual([252, 253]);
  });

  it('reads a GPX TrackPointExtension, which is how a Garmin writes power', () => {
    // GPX has no <Watts> of its own; the sensor data lives in a vendor extension under
    // the same local name, so the same selector catches it without knowing the prefix.
    const garmin = `<?xml version="1.0"?>
<gpx xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" version="1.1"><trk><trkseg>
${Array.from({ length: 4 }, (_, i) => {
  return `  <trkpt lat="-6.2" lon="${106.8 + i * 0.001}"><ele>${10 + i}</ele><time>${new Date(Date.parse('2026-09-01T06:00:00Z') + i * 10_000).toISOString()}</time>
    <extensions><gpxtpx:TrackPointExtension><gpxtpx:Watts>${300 + i * 5}</gpxtpx:Watts><gpxtpx:hr>${140 + i}</gpxtpx:hr><gpxtpx:cad>90</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions>
  </trkpt>`;
}).join('\n')}
</trkseg></trk></gpx>`;

    const ride = parseCourse(garmin, 'garmin.gpx');
    expect(ride.source).toBe('gpx');
    expect(ride.points.map((p) => p.watts)).toEqual([300, 305, 310, 315]);
    expect(ride.points.map((p) => p.hr)).toEqual([140, 141, 142, 143]);
    expect(ride.points.every((p) => p.cad === 90)).toBe(true);
  });

  it('leaves a plain GPX without extensions exactly as it was', () => {
    // No sensor fields invented, no NaN written — the no-meter case must stay a
    // no-meter case so the honest empty state still fires.
    const plain = parseCourse(gpx({ points: 5, startAlt: 20 }), 'plain.gpx');
    expect(plain.points.every((p) => p.watts === undefined && p.hr === undefined && p.cad === undefined)).toBe(true);
  });
});

describe('haversineM', () => {
  it('measures a known distance: 1° of latitude ≈ 111 km', () => {
    expect(haversineM(0, 0, 1, 0)).toBeGreaterThan(111_000);
    expect(haversineM(0, 0, 1, 0)).toBeLessThan(112_000);
  });

  it('is zero for the same point', () => {
    expect(haversineM(-6.2, 106.8, -6.2, 106.8)).toBe(0);
  });
});

describe('decimateTrack', () => {
  it('leaves short tracks untouched', () => {
    expect(decimateTrack([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  it('thins long tracks but keeps the endpoints', () => {
    const points = Array.from({ length: 1000 }, (_, i) => i);
    const out = decimateTrack(points, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out[0]).toBe(0);
    expect(out.at(-1)).toBe(999);
  });
});

describe('pause threshold', () => {
  it('is the documented 90 seconds', () => {
    expect(PAUSE_GAP_SEC).toBe(90);
  });
});