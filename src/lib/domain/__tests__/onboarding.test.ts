import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES,
  PREVIEW_FTP_W,
  ageFromBirthYear,
  archetype,
  ftpFromTwentyMinute,
  hrReserve,
  tanakaHrMax,
  volumePlan,
  wattsPerKg,
  wkgCategory
} from '../onboarding';

/**
 * These guard the numbers the onboarding cards print live. They are the first figures a new
 * rider sees, and two of them (FTP from a 20-minute test, HRmax) are later treated as real
 * thresholds — so an off-by-one here would silently shape the whole training plan.
 */
describe('wattsPerKg', () => {
  it('divides FTP by mass', () => {
    expect(wattsPerKg(250, 70)).toBeCloseTo(3.57, 2);
  });

  it('returns null for a zero or negative weight rather than Infinity', () => {
    expect(wattsPerKg(250, 0)).toBeNull();
    expect(wattsPerKg(250, -70)).toBeNull();
  });

  it('returns null for a non-positive FTP', () => {
    expect(wattsPerKg(0, 70)).toBeNull();
    expect(wattsPerKg(-250, 70)).toBeNull();
  });
});

describe('wkgCategory', () => {
  it('places a typical club rider in the rouleur band', () => {
    expect(wkgCategory(3.0).key).toBe('rouleur');
  });

  it('places a strong climber above the club band', () => {
    expect(wkgCategory(3.8).key).toBe('climber');
  });

  it('places an elite engine at the top of the ladder', () => {
    expect(wkgCategory(4.8).key).toBe('elite');
  });

  it('places a beginner in the base band', () => {
    expect(wkgCategory(2.0).key).toBe('base');
  });

  it('labels every band with a coaching word, never a bare grade', () => {
    for (const value of [2, 3, 3.5, 4.1, 5]) {
      expect(wkgCategory(value).label.length).toBeGreaterThan(0);
    }
  });
});

describe('tanakaHrMax', () => {
  it('matches the 208 − 0.7 × age formula', () => {
    // 208 − 0.7 × 30 = 187
    expect(tanakaHrMax(30)).toBe(187);
    // 208 − 0.7 × 50 = 173
    expect(tanakaHrMax(50)).toBe(173);
  });

  it('rejects a non-positive age', () => {
    expect(tanakaHrMax(0)).toBeNull();
    expect(tanakaHrMax(-30)).toBeNull();
  });
});

describe('hrReserve', () => {
  it('is the span between resting and maximum', () => {
    expect(hrReserve(55, 190)).toBe(135);
  });

  it('returns null when maximum does not exceed resting', () => {
    expect(hrReserve(190, 190)).toBeNull();
    expect(hrReserve(200, 190)).toBeNull();
  });
});

describe('ftpFromTwentyMinute', () => {
  it('takes 95% of the average power, rounded', () => {
    expect(ftpFromTwentyMinute(300)).toBe(285);
  });

  it('rounds to a whole watt', () => {
    // 263 × 0.95 = 249.85
    expect(ftpFromTwentyMinute(263)).toBe(250);
  });

  it('rejects a non-positive effort', () => {
    expect(ftpFromTwentyMinute(0)).toBeNull();
    expect(ftpFromTwentyMinute(-300)).toBeNull();
  });
});

describe('ageFromBirthYear', () => {
  it('reports age against the supplied year, not the wall clock', () => {
    expect(ageFromBirthYear(1990, new Date('2026-01-01'))).toBe(36);
  });

  it('rejects a year in the future', () => {
    expect(ageFromBirthYear(2030, new Date('2026-01-01'))).toBeNull();
  });

  it('rejects an implausibly early year', () => {
    expect(ageFromBirthYear(1800, new Date('2026-01-01'))).toBeNull();
  });
});

describe('volumePlan', () => {
  it('derives hours at 28 km/h, rounded to a clean half hour', () => {
    // 140 / 28 = 5.0
    expect(volumePlan(140)?.hoursPerWeek).toBe(5);
  });

  it('scales rides per week with distance', () => {
    expect(volumePlan(60)?.ridesPerWeek).toBe(2);
    expect(volumePlan(120)?.ridesPerWeek).toBe(3);
    expect(volumePlan(200)?.ridesPerWeek).toBe(4);
    expect(volumePlan(300)?.ridesPerWeek).toBe(5);
  });

  it('echoes the distance back so the card can label itself', () => {
    expect(volumePlan(180)?.kmPerWeek).toBe(180);
  });

  it('returns null for a zero target', () => {
    expect(volumePlan(0)).toBeNull();
  });
});

describe('preview FTP', () => {
  it('is a fixed reference so the live preview never implies a measurement', () => {
    expect(PREVIEW_FTP_W).toBe(250);
  });
});

describe('archetypes', () => {
  it('offers exactly three, with structured as the sensible default', () => {
    expect(ARCHETYPES).toHaveLength(3);
    expect(archetype('structured').key).toBe('structured');
  });

  it('falls back to the middle tier for an unknown key', () => {
    expect(archetype('nonsense').key).toBe('structured');
  });

  it('gives each tier a positive starting distance for the slider', () => {
    for (const a of ARCHETYPES) {
      expect(a.defaultKm).toBeGreaterThan(0);
    }
  });
});
