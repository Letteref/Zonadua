import { describe, it, expect } from 'vitest';
import {
  STRAVA_API,
  SYNC_BATCH_DEFAULT,
  STRAVA_PER_PAGE,
  activitiesListUrl,
  decodeStreams,
  mapSummary,
  streamsUrl
} from '../sync';

describe('strava sync mapping', () => {
  describe('URLs', () => {
    it('pages activities with the documented page size and an after cursor', () => {
      const url = new URL(activitiesListUrl(1_700_000_000));
      expect(url.origin + url.pathname).toBe(`${STRAVA_API}/athlete/activities`);
      expect(url.searchParams.get('per_page')).toBe(String(STRAVA_PER_PAGE));
      expect(url.searchParams.get('after')).toBe('1700000000');
      expect(SYNC_BATCH_DEFAULT).toBe(50);
    });

    it('floors a fractional cursor rather than sending a float', () => {
      expect(new URL(activitiesListUrl(10.9)).searchParams.get('after')).toBe('10');
    });

    it('asks for keyed streams, and only the keys the app stores', () => {
      const url = new URL(streamsUrl(4242));
      expect(url.origin + url.pathname).toBe(`${STRAVA_API}/activities/4242/streams`);
      expect(url.searchParams.get('key_by_type')).toBeNull();
      const keys = url.searchParams.get('keys')!.split(',');
      expect(keys).toEqual(['time', 'latlng', 'altitude', 'watts', 'heartrate', 'cadence']);
      // unused series are not fetched: they are bytes to download and rows for the pruner to delete
      expect(keys).not.toContain('velocity_smooth');
      expect(keys).not.toContain('temp');
    });
  });

  describe('mapSummary', () => {
    const full = {
      id: 999,
      name: '  Morning loop  ',
      start_date: '2026-10-01T06:30:00Z',
      distance: 42_500,
      moving_time: 5_400,
      elapsed_time: 6_000,
      total_elevation_gain: 620,
      average_watts: 190,
      weighted_average_watts: 210,
      average_heartrate: 148,
      max_heartrate: 172,
      kilojoules: 1_026,
      commute: true
    };

    it('maps every measured field and tags the row as real data', () => {
      const a = mapSummary(full, 111)!;
      expect(a.id).toBe('999');
      expect(a.name).toBe('Morning loop');
      expect(a.source).toBe('strava');
      expect(a.synthetic).toBe(false);
      expect(a.mVersion).toBeUndefined(); // metrics are (re)computed by the loader, not here
      expect(a.date).toBe('2026-10-01T06:30:00.000Z');
      expect(a.distanceKm).toBe(42.5); // Strava sends metres
      expect(a.movingSec).toBe(5_400);
      expect(a.elevGainM).toBe(620);
      expect(a.avgPower).toBe(190);
      expect(a.np).toBe(210); // Strava's weighted average is the normalized figure
      expect(a.avgHr).toBe(148);
      expect(a.kcal).toBe(1_026);
      expect(a.commute).toBe(true);
      expect(a.updatedAt).toBe(111);
    });

    it('leaves a missing measurement absent instead of writing a zero', () => {
      const a = mapSummary({ id: 1, start_date: '2026-10-01T06:30:00Z', distance: 1_000 })!;
      expect(a.avgPower).toBeUndefined();
      expect(a.np).toBeUndefined();
      expect(a.avgHr).toBeUndefined();
      expect(a.maxHr).toBeUndefined();
      expect(a.commute).toBeUndefined();
      expect(a.kcal).toBe(0); // work is genuinely unknown, and the field is not optional
      expect(a.movingSec).toBe(0);
    });

    it('refuses a summary with no identity or no date', () => {
      expect(mapSummary({ start_date: '2026-10-01T06:30:00Z' })).toBeNull();
      expect(mapSummary({ id: 1 })).toBeNull();
      expect(mapSummary({ id: 1, start_date: 'not a date' })).toBeNull();
      expect(mapSummary(null as never)).toBeNull();
    });

    it('accepts a string id and falls back to a readable name', () => {
      const a = mapSummary({ id: 'abc', start_date: '2026-10-01T06:30:00Z', name: '   ' })!;
      expect(a.id).toBe('abc');
      expect(a.name).toBe('Strava activity');
    });
  });

  describe('decodeStreams', () => {
    it('decodes a full keyed payload into sample rows', () => {
      const samples = decodeStreams([
        { type: 'time', data: [0, 1, 2] },
        { type: 'latlng', data: [[-6.2, 106.8], [-6.21, 106.81], [-6.22, 106.82]] },
        { type: 'altitude', data: [10, 12, 15] },
        { type: 'watts', data: [100, 200, 300] },
        { type: 'heartrate', data: [120, 130, 140] },
        { type: 'cadence', data: [80, 85, 90] }
      ])!;
      expect(samples).toHaveLength(3);
      expect(samples[0]).toEqual({ t: 0, lat: -6.2, lng: 106.8, alt: 10, watts: 100, hr: 120, cad: 80 });
      expect(samples[2].watts).toBe(300);
    });

    it('ignores keys the app does not store instead of failing', () => {
      const samples = decodeStreams([
        { type: 'time', data: [0, 1] },
        { type: 'velocity_smooth', data: [5, 6] },
        { type: 'moving', data: [true, false] }
      ])!;
      expect(samples).toEqual([{ t: 0 }, { t: 1 }]);
    });

    it('refuses ragged series rather than pairing watts with the wrong minute', () => {
      expect(
        decodeStreams([
          { type: 'watts', data: [100, 200, 300] },
          { type: 'heartrate', data: [120, 130] }
        ])
      ).toBeNull();
    });

    it('refuses an unusable payload outright', () => {
      expect(decodeStreams(null)).toBeNull();
      expect(decodeStreams({})).toBeNull();
      expect(decodeStreams([])).toBeNull();
      expect(decodeStreams([{ type: 'watts' }])).toBeNull();
      expect(decodeStreams([{ data: [1] }])).toBeNull();
      expect(decodeStreams([{ type: 'latlng', data: [[1]] }])).toBeNull();
      expect(decodeStreams([{ type: 'latlng', data: [['a', 'b']] }])).toBeNull();
    });
  });
});
