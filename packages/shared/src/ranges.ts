export const RANGE_PRESETS = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'this_month',
  'previous_month',
  'custom',
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

export interface DateRange {
  from: Date;
  to: Date;
}

const startOfUtcDay = (date: Date): Date => {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
};

const addDays = (date: Date, days: number): Date => {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
};

/**
 * Resolve a preset to a half-open [from, to) UTC window.
 * Using UTC server-side keeps daily buckets stable; the client renders in the
 * user's timezone.
 */
export function resolveRange(preset: RangePreset, now: Date = new Date()): DateRange {
  const today = startOfUtcDay(now);
  switch (preset) {
    case 'today':
      return { from: today, to: addDays(today, 1) };
    case 'yesterday':
      return { from: addDays(today, -1), to: today };
    case 'last_7_days':
      return { from: addDays(today, -6), to: addDays(today, 1) };
    case 'last_30_days':
      return { from: addDays(today, -29), to: addDays(today, 1) };
    case 'last_90_days':
      return { from: addDays(today, -89), to: addDays(today, 1) };
    case 'this_month': {
      const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      return { from, to: addDays(today, 1) };
    }
    case 'previous_month': {
      const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      return { from, to };
    }
    default:
      return { from: addDays(today, -6), to: addDays(today, 1) };
  }
}

export function isRangePreset(value: string): value is RangePreset {
  return (RANGE_PRESETS as readonly string[]).includes(value);
}

export function daysInMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}
