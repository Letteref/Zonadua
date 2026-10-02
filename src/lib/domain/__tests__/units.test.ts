import { describe, expect, it } from 'vitest';
import {
  KG_PER_LB,
  KM_PER_MILE,
  convertDistance,
  convertElevation,
  convertSpeed,
  convertWeight,
  distanceUnit,
  elevationUnit,
  formatDistance,
  formatElevation,
  formatPowerPerWeight,
  formatSpeed,
  formatWeight,
  speedUnit,
  splitValue,
  weightUnit
} from '../units';

describe('conversions', () => {
  it('is the identity in metric', () => {
    expect(convertDistance(42, 'metric')).toBe(42);
    expect(convertWeight(70, 'metric')).toBe(70);
    expect(convertElevation(500, 'metric')).toBe(500);
    expect(convertSpeed(30, 'metric')).toBe(30);
  });

  it('converts to imperial with the standard factors', () => {
    expect(convertDistance(42, 'imperial')).toBeCloseTo(42 / KM_PER_MILE, 6);
    expect(convertWeight(68.2, 'imperial')).toBeCloseTo(68.2 / KG_PER_LB, 6);
    expect(convertElevation(304.8, 'imperial')).toBeCloseTo(1000, 6); // 304.8 m is exactly 1000 ft
    expect(convertElevation(1000, 'imperial')).toBeCloseTo(3280.84, 2);
    expect(convertSpeed(30, 'imperial')).toBeCloseTo(30 / KM_PER_MILE, 6);
  });

  it('returns the right unit labels', () => {
    expect([distanceUnit('metric'), distanceUnit('imperial')]).toEqual(['km', 'mi']);
    expect([weightUnit('metric'), weightUnit('imperial')]).toEqual(['kg', 'lb']);
    expect([elevationUnit('metric'), elevationUnit('imperial')]).toEqual(['m', 'ft']);
    expect([speedUnit('metric'), speedUnit('imperial')]).toEqual(['km/h', 'mph']);
  });
});

describe('formatters', () => {
  it('formats distance with one decimal by default', () => {
    expect(formatDistance(42, 'metric')).toBe('42.0 km');
    expect(formatDistance(42, 'imperial')).toBe('26.1 mi');
    expect(formatDistance(200.4, 'metric', 0)).toBe('200 km');
  });

  it('formats elevation with a space thousands separator in imperial', () => {
    expect(formatElevation(672, 'metric')).toBe('672 m');
    expect(formatElevation(672, 'imperial')).toBe('2 205 ft'); // 2204.7 ft, rounded not truncated
  });

  it('formats weight without a decimal in imperial', () => {
    expect(formatWeight(68.2, 'metric')).toBe('68.2 kg');
    expect(formatWeight(68.2, 'imperial')).toBe('150 lb');
  });

  it('formats speed', () => {
    expect(formatSpeed(30, 'metric')).toBe('30.0 km/h');
    expect(formatSpeed(30, 'imperial')).toBe('18.6 mph');
  });

  it('formats power per weight per unit system', () => {
    expect(formatPowerPerWeight(275, 68.2, 'metric')).toBe('4.0 W/kg');
    expect(formatPowerPerWeight(275, 68.2, 'imperial')).toBe('1.8 W/lb');
  });

  it('refuses to divide by a non-positive weight', () => {
    expect(formatPowerPerWeight(275, 0, 'metric')).toBe('—');
    expect(formatPowerPerWeight(275, -1, 'metric')).toBe('—');
  });
});

describe('splitValue', () => {
  it('separates the number from its unit', () => {
    expect(splitValue('42.0 km')).toEqual({ value: '42.0', unit: 'km' });
    expect(splitValue('2 204 ft')).toEqual({ value: '2 204', unit: 'ft' });
  });

  it('returns the whole string when there is no unit', () => {
    expect(splitValue('42')).toEqual({ value: '42', unit: '' });
  });

  it('never produces a thousands separator from a plain number', () => {
    expect(splitValue('1000 m')).toEqual({ value: '1000', unit: 'm' });
  });

  it('keeps a minus sign with the number', () => {
    expect(splitValue('-13 TSB')).toEqual({ value: '-13', unit: 'TSB' });
  });
});