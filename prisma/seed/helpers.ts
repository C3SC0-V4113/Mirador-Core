export const MONTH_COUNT = 31;
export const START_YEAR = 2024;
export const START_MONTH = 0;

export function monthIndex(date: Date): number {
  return (date.getUTCFullYear() - START_YEAR) * 12 + date.getUTCMonth();
}

export function monthFromIndex(index: number): Date {
  return new Date(Date.UTC(START_YEAR + Math.floor(index / 12), index % 12, 1));
}

export function getMonthStarts(): Date[] {
  return Array.from({ length: MONTH_COUNT }, (_, i) => monthFromIndex(i));
}

export function formatMonth(date: Date): string {
  return `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function addHours(date: Date, hours: number): Date {
  const result = new Date(date);
  result.setUTCHours(result.getUTCHours() + hours);
  return result;
}

export function requireId(values: Map<string, string>, key: string): string {
  const value = values.get(key);

  if (value === undefined) {
    throw new Error(`Missing seeded id for ${key}.`);
  }

  return value;
}

export function hashInt(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) + hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function deterministicChoice<T>(seed: string, choices: readonly T[]): T {
  return choices[hashInt(seed) % choices.length];
}

export function deterministicInRange(seed: string, min: number, max: number): number {
  return min + (hashInt(seed) % (max - min + 1));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
