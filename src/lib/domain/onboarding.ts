/**
 * Onboarding domain rules — pure, no Dexie, no browser.
 *
 * New riders answer five questions. This module owns the arithmetic and the wording those
 * answers produce, so the numbers shown live in the UI (W/kg, category, HRmax estimate,
 * weekly hours) are computed in one place and testable without mounting a component.
 */

/** A standard FTP used only for the live physics preview before the rider has logged one. */
export const PREVIEW_FTP_W = 250;

export interface WkgCategory {
  key: string;
  label: string;
}

/**
 * W/kg → category. Bands follow the common club/racing ladder; the label is what the rider
 * reads on the preview card, so it must be a real coaching word, not a grade.
 */
export const WKG_CATEGORIES: readonly (WkgCategory & { min: number })[] = [
  { min: 4.6, key: 'elite', label: 'Elite engine' },
  { min: 4.0, key: 'race', label: 'Race contender' },
  { min: 3.4, key: 'climber', label: 'Cat 3 climber' },
  { min: 2.7, key: 'rouleur', label: 'Club rouleur' },
  { min: 0, key: 'base', label: 'Base builder' }
];

export function wkgCategory(wkg: number): WkgCategory {
  const band = WKG_CATEGORIES.find((c) => wkg >= c.min) ?? WKG_CATEGORIES[WKG_CATEGORIES.length - 1];
  return { key: band.key, label: band.label };
}

/** Watts per kilogram, or null when weight is not yet a usable number. */
export function wattsPerKg(ftpW: number, weightKg: number): number | null {
  if (!Number.isFinite(ftpW) || !Number.isFinite(weightKg) || weightKg <= 0 || ftpW <= 0) return null;
  return ftpW / weightKg;
}

/** Age in whole years from a birth year, or null when the year is not usable. */
export function ageFromBirthYear(birthYear: number, now = new Date()): number | null {
  if (!Number.isFinite(birthYear) || birthYear < 1900 || birthYear > now.getFullYear()) return null;
  return now.getFullYear() - birthYear;
}

/**
 * Tanaka &amp; colleagues' age-predicted maximum heart rate: 208 − 0.7 × age. Chosen over the
 * older 220 − age because it stays accurate into the ages most riders actually are, and the
 * UI labels it an estimate so nobody treats it as measured.
 */
export function tanakaHrMax(age: number): number | null {
  if (!Number.isFinite(age) || age <= 0) return null;
  return Math.round(208 - 0.7 * age);
}

/** Heart-rate reserve — the band a given RHR/HRmax pair leaves to train in. */
export function hrReserve(restingHr: number, maxHr: number): number | null {
  if (!Number.isFinite(restingHr) || !Number.isFinite(maxHr) || restingHr <= 0 || maxHr <= restingHr) return null;
  return Math.round(maxHr - restingHr);
}

/** FTP from a 20-minute all-out test — 95% of the mean power held for the effort. */
export function ftpFromTwentyMinute(avgW: number): number | null {
  if (!Number.isFinite(avgW) || avgW <= 0) return null;
  return Math.round(avgW * 0.95);
}

export interface VolumePlan {
  kmPerWeek: number;
  hoursPerWeek: number;
  ridesPerWeek: number;
}

/**
 * Weekly volume target → hours and rides, for the line under the slider. Assumes an average
 * moving speed of 28 km/h, which is a realistic mixed-pace road figure; it is a planning
 * hint, not a promise, so it rounds to a clean half hour.
 */
export function volumePlan(kmPerWeek: number): VolumePlan | null {
  if (!Number.isFinite(kmPerWeek) || kmPerWeek <= 0) return null;
  const hoursPerWeek = Math.round((kmPerWeek / 28) * 2) / 2;
  const ridesPerWeek = kmPerWeek < 80 ? 2 : kmPerWeek < 160 ? 3 : kmPerWeek < 250 ? 4 : 5;
  return { kmPerWeek, hoursPerWeek, ridesPerWeek };
}

/** Experience archetypes, in the order the picker shows them. Intermediate is the default. */
export const ARCHETYPES = [
  {
    key: 'foundation',
    title: 'Finding your rhythm',
    tagline: 'Foundation · 1–2 rides/wk',
    blurb: 'Building aerobic base, settling into Zone 2 pacing, making saddle time a habit.',
    defaultKm: 80
  },
  {
    key: 'structured',
    title: 'Building the engine',
    tagline: 'Structured · 3–4 rides/wk',
    blurb: 'Regular group rides or sportives. Comfortable holding tempo and executing intervals.',
    defaultKm: 160
  },
  {
    key: 'performance',
    title: 'Race &amp; gran fondo ready',
    tagline: 'Performance · 5+ rides/wk',
    blurb: 'Peak threshold work, sustained alpine passes, criteriums, timed century events.',
    defaultKm: 250
  }
] as const;

export type ArchetypeKey = (typeof ARCHETYPES)[number]['key'];

export function archetype(key: string) {
  return ARCHETYPES.find((a) => a.key === key) ?? ARCHETYPES[1];
}
