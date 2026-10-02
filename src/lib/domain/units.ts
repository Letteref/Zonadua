/**
 * Unit conversion and display — PRD F8 / F2 (the `settings.unit` flag was stored but
 * consumed by nothing until now).
 *
 * Everything is stored metric (km, kg, m, km/h). These helpers convert at the display
 * edge only, so switching units never touches stored data and never invalidates a
 * derived metric.
 */

export type UnitSystem = 'metric' | 'imperial';

export const KM_PER_MILE = 1.609344;
export const KG_PER_LB = 0.45359237;
export const M_PER_FT = 0.3048;

export const distanceUnit = (unit: UnitSystem): 'km' | 'mi' =>
  unit === 'imperial' ? 'mi' : 'km';

export const weightUnit = (unit: UnitSystem): 'kg' | 'lb' => (unit === 'imperial' ? 'lb' : 'kg');

export const elevationUnit = (unit: UnitSystem): 'm' | 'ft' => (unit === 'imperial' ? 'ft' : 'm');

export const speedUnit = (unit: UnitSystem): 'km/h' | 'mph' => (unit === 'imperial' ? 'mph' : 'km/h');

export function convertDistance(km: number, unit: UnitSystem): number {
  return unit === 'imperial' ? km / KM_PER_MILE : km;
}

export function convertWeight(kg: number, unit: UnitSystem): number {
  return unit === 'imperial' ? kg / KG_PER_LB : kg;
}

export function convertElevation(m: number, unit: UnitSystem): number {
  return unit === 'imperial' ? m / M_PER_FT : m;
}

export function convertSpeed(kmh: number, unit: UnitSystem): number {
  return unit === 'imperial' ? kmh / KM_PER_MILE : kmh;
}

/**
 * Split a formatted number from its unit so UI can typeset them differently
 * (big tabular number, small dim unit) without duplicating rounding logic.
 */
export function splitValue(value: string): { value: string; unit: string } {
  const i = value.lastIndexOf(' ');
  if (i < 0) return { value, unit: '' };
  return { value: value.slice(0, i), unit: value.slice(i + 1) };
}

/** "42.0 km" / "26.1 mi" */
export function formatDistance(km: number, unit: UnitSystem, digits = 1): string {
  return `${convertDistance(km, unit).toFixed(digits)} ${distanceUnit(unit)}`;
}

/** "672 m" / "2 204 ft" — imperial elevation reads better with a thousands separator. */
export function formatElevation(m: number, unit: UnitSystem): string {
  const v = convertElevation(m, unit);
  const rounded = Math.round(v);
  const text = unit === 'imperial' ? rounded.toLocaleString('en-US').replace(/,/g, ' ') : String(rounded);
  return `${text} ${elevationUnit(unit)}`;
}

/** "68.2 kg" / "150 lb" */
export function formatWeight(kg: number, unit: UnitSystem, digits = 1): string {
  const v = convertWeight(kg, unit);
  // imperial body weight reads better without a decimal: 150 lb, not 150.4 lb
  return unit === 'imperial'
    ? `${Math.round(v)} ${weightUnit(unit)}`
    : `${v.toFixed(digits)} ${weightUnit(unit)}`;
}

/** "30 km/h" / "18.6 mph" */
export function formatSpeed(kmh: number, unit: UnitSystem, digits = 1): string {
  return `${convertSpeed(kmh, unit).toFixed(digits)} ${speedUnit(unit)}`;
}

/** Power-to-weight: "4.0 W/kg" / "1.8 W/lb" */
export function formatPowerPerWeight(watts: number, kg: number, unit: UnitSystem): string {
  if (!Number.isFinite(kg) || kg <= 0) return '—';
  const value = unit === 'imperial' ? watts / (kg / KG_PER_LB) : watts / kg;
  return `${value.toFixed(1)} W/${weightUnit(unit)}`;
}