import type { Bucket, EnergyPoint, TelemetrySample } from '@wattnexa/types';

const round = (value: number, digits = 3): number => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

/** Truncate a timestamp to the start of its hour/day/month (UTC). */
export function bucketStart(input: Date | string, bucket: Bucket): Date {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return new Date(0);
  date.setUTCMinutes(0, 0, 0);
  if (bucket === 'hour') return date;
  date.setUTCHours(0, 0, 0, 0);
  if (bucket === 'day') return date;
  date.setUTCDate(1);
  return date;
}

export function bucketKey(input: Date | string, bucket: Bucket): string {
  return bucketStart(input, bucket).toISOString();
}

interface AggregateOptions {
  /** Fallback integration window when cumulative energy is unavailable. */
  intervalSeconds?: number;
}

/**
 * Aggregate raw samples into chart-ready points.
 *
 * Energy per bucket prefers the difference of cumulative `energyKwh` readings.
 * When a device does not report cumulative energy (a non-invasive CT sensor
 * may not), power is integrated over the sampling interval instead. The
 * resulting figure is an estimate and is labelled as such in the UI.
 */
export function aggregateSamples(
  samples: TelemetrySample[],
  bucket: Bucket,
  options: AggregateOptions = {},
): EnergyPoint[] {
  const intervalSeconds = options.intervalSeconds ?? 60;
  const groups = new Map<string, TelemetrySample[]>();

  for (const sample of samples) {
    const key = bucketKey(sample.recordedAt, bucket);
    const existing = groups.get(key);
    if (existing) existing.push(sample);
    else groups.set(key, [sample]);
  }

  const points: EnergyPoint[] = [];

  for (const [key, group] of groups) {
    const sorted = [...group].sort(
      (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
    );

    let energyKwh = 0;
    const cumulative = sorted.filter((s) => s.energyKwh != null) as Array<
      TelemetrySample & { energyKwh: number }
    >;

    // A single cumulative reading carries no delta information — the meter
    // total is not the energy used inside this bucket. Fall through to power
    // integration instead.
    if (cumulative.length >= 2) {
      const first = cumulative[0] as TelemetrySample & { energyKwh: number };
      const last = cumulative[cumulative.length - 1] as TelemetrySample & { energyKwh: number };
      energyKwh = last.energyKwh - first.energyKwh;
    }

    if (energyKwh <= 0) {
      const powers = sorted
        .map((s) => s.activePower)
        .filter((p): p is number => p != null && Number.isFinite(p));
      if (powers.length > 0) {
        const mean = powers.reduce((sum, p) => sum + p, 0) / powers.length;
        energyKwh = (mean * (sorted.length * intervalSeconds)) / 3_600_000;
      }
    }

    const powers = sorted
      .map((s) => s.activePower)
      .filter((p): p is number => p != null && Number.isFinite(p));

    points.push({
      timestamp: key,
      energyKwh: round(Math.max(0, energyKwh)),
      averagePowerW: powers.length
        ? round(powers.reduce((sum, p) => sum + p, 0) / powers.length, 1)
        : 0,
      peakPowerW: powers.length ? round(Math.max(...powers), 1) : 0,
      samples: sorted.length,
    });
  }

  return points.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/** Energy in kWh consumed between two cumulative readings. */
export function energyDelta(fromKwh: number | null, toKwh: number | null): number | null {
  if (fromKwh == null || toKwh == null) return null;
  const delta = toKwh - fromKwh;
  // Meter resets / rollovers produce negative deltas; treat as no data.
  if (delta < 0) return null;
  return round(delta);
}

/** Power factor = active / apparent power, bounded to 0..1. */
export function derivePowerFactor(
  activePower: number | null,
  apparentPower: number | null,
): number | null {
  if (activePower == null || apparentPower == null) return null;
  if (apparentPower <= 0) return null;
  return round(Math.min(1, Math.max(0, activePower / apparentPower)), 2);
}

export function deriveApparentPower(voltage: number | null, current: number | null): number | null {
  if (voltage == null || current == null) return null;
  return round(voltage * current, 1);
}

/** Simple linear trend over the supplied points, in kWh per day. */
export function consumptionTrend(points: EnergyPoint[]): number {
  if (points.length < 2) return 0;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return 0;
  const days =
    (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / 86_400_000;
  if (days <= 0) return 0;
  return round((last.energyKwh - first.energyKwh) / days, 3);
}
