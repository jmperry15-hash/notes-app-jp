/**
 * Postgres timestamps carry microseconds ("2026-10-14T18:36:00.123456+00:00"), more precision than
 * a JS Date. These helpers compare them exactly.
 */
const TS_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/** Microseconds since the epoch (fits safely in a double until the year 2255). */
export function tsMicros(value: string): number {
  const match = TS_PATTERN.exec(value.trim());
  if (!match) {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) throw new Error(`Invalid timestamp: ${value}`);
    return ms * 1000;
  }
  const [, date, time, fraction = '', zone = 'Z'] = match;
  let offset = zone;
  if (zone !== 'Z') {
    const digits = zone.slice(1).replace(':', '');
    offset = `${zone[0]}${digits.slice(0, 2)}:${(digits.slice(2) || '00').padEnd(2, '0')}`;
  }
  const seconds = Date.parse(`${date}T${time}${offset}`);
  if (Number.isNaN(seconds)) throw new Error(`Invalid timestamp: ${value}`);
  return seconds * 1000 + Number(fraction.padEnd(6, '0').slice(0, 6));
}

export function compareTs(a: string, b: string): number {
  return tsMicros(a) - tsMicros(b);
}

/** Formats microseconds the way Postgres/PostgREST does, e.g. 2026-10-14T18:36:00.123456+00:00 */
export function microsToIso(micros: number): string {
  const ms = Math.floor(micros / 1000);
  const base = new Date(ms).toISOString().slice(0, 19);
  const fraction = String(micros - Math.floor(micros / 1_000_000) * 1_000_000).padStart(6, '0');
  return `${base}.${fraction}+00:00`;
}

/** An ISO timestamp `ms` milliseconds before `value` (used to re-read a small overlap window). */
export function tsMinus(value: string, ms: number): string {
  return new Date(Math.floor(tsMicros(value) / 1000) - ms).toISOString();
}
