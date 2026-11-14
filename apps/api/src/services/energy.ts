import { db, tariffSlabs, tariffs } from '@wattnexa/database';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { CostBreakdown, EnergyPoint, Insight, TariffInput } from '@wattnexa/types';
import { calculateCost, projectMonthly } from '@wattnexa/shared';

type Bucket = 'hour' | 'day' | 'month';

const BUCKET_HOURS: Record<Bucket, number> = { hour: 1, day: 24, month: 720 };
const BUCKET_FORMAT: Record<Bucket, string> = {
  hour: '%Y-%m-%d %H:00:00',
  day: '%Y-%m-%d 00:00:00',
  month: '%Y-%m-01 00:00:00',
};

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

interface RawRow {
  bucket_key: string;
  energy_delta: unknown;
  avg_power: unknown;
  peak_power: unknown;
  samples: unknown;
}

/**
 * Aggregate in SQL: one row per bucket instead of loading every reading.
 * Energy prefers the cumulative meter delta; when a device does not report
 * cumulative energy, average power is integrated over the bucket.
 */
export async function energySeries(
  deviceIds: string[],
  from: Date,
  to: Date,
  bucket: Bucket,
): Promise<EnergyPoint[]> {
  if (deviceIds.length === 0) return [];
  const inList = sql.join(deviceIds.map((id) => sql`${id}`), sql`, `);
  const format = BUCKET_FORMAT[bucket];

  const [rows] = await db.execute(sql`
    SELECT DATE_FORMAT(recorded_at, ${format}) AS bucket_key,
           MAX(energy_kwh) - MIN(energy_kwh) AS energy_delta,
           AVG(active_power) AS avg_power,
           MAX(active_power) AS peak_power,
           COUNT(*) AS samples
    FROM device_telemetry
    WHERE device_id IN (${inList})
      AND recorded_at >= ${from}
      AND recorded_at < ${to}
    GROUP BY bucket_key
    ORDER BY bucket_key
  `);

  return (rows as unknown as RawRow[]).map((row) => {
    const delta = num(row.energy_delta);
    const avgPower = num(row.avg_power);
    const energyKwh = delta > 0 ? delta : (avgPower * BUCKET_HOURS[bucket]) / 1000;
    return {
      timestamp: `${row.bucket_key.replace(' ', 'T')}.000Z`,
      energyKwh: Math.max(0, Number(energyKwh.toFixed(3))),
      averagePowerW: Number(avgPower.toFixed(1)),
      peakPowerW: Number(num(row.peak_power).toFixed(1)),
      samples: num(row.samples),
    };
  });
}

export async function energyTotal(deviceIds: string[], from: Date, to: Date): Promise<number> {
  if (deviceIds.length === 0) return 0;
  const inList = sql.join(deviceIds.map((id) => sql`${id}`), sql`, `);
  const [rows] = await db.execute(sql`
    SELECT MAX(energy_kwh) - MIN(energy_kwh) AS delta,
           AVG(active_power) AS avg_power,
           COUNT(*) AS samples
    FROM device_telemetry
    WHERE device_id IN (${inList})
      AND recorded_at >= ${from}
      AND recorded_at < ${to}
  `);
  const row = (rows as unknown as RawRow[])[0];
  if (!row) return 0;
  const delta = num(row.energy_delta);
  if (delta > 0) return Number(delta.toFixed(3));
  const hours = (to.getTime() - from.getTime()) / 3_600_000;
  return Number(((num(row.avg_power) * hours) / 1000).toFixed(3));
}

export interface ActiveTariff {
  id: string;
  name: string;
  provider: string | null;
  region: string | null;
  currency: string;
  fixedCharge: number;
  taxPercent: number;
  input: TariffInput;
  slabs: Array<{ id: string; minKwh: number; maxKwh: number | null; ratePerKwh: number }>;
}

export async function activeTariff(homeId: string): Promise<ActiveTariff | null> {
  const [tariff] = await db
    .select()
    .from(tariffs)
    .where(and(eq(tariffs.homeId, homeId), eq(tariffs.isActive, true)))
    .limit(1);
  if (!tariff) return null;

  const slabs = await db
    .select()
    .from(tariffSlabs)
    .where(eq(tariffSlabs.tariffId, tariff.id))
    .orderBy(tariffSlabs.sortOrder);

  const input: TariffInput = {
    currency: tariff.currency,
    fixedCharge: tariff.fixedCharge,
    taxPercent: tariff.taxPercent,
    slabs: slabs.map((slab) => ({
      minKwh: slab.minKwh,
      maxKwh: slab.maxKwh,
      ratePerKwh: slab.ratePerKwh,
    })),
  };

  return {
    id: tariff.id,
    name: tariff.name,
    provider: tariff.provider,
    region: tariff.region,
    currency: tariff.currency,
    fixedCharge: tariff.fixedCharge,
    taxPercent: tariff.taxPercent,
    input,
    slabs: slabs.map((slab) => ({
      id: slab.id,
      minKwh: slab.minKwh,
      maxKwh: slab.maxKwh,
      ratePerKwh: slab.ratePerKwh,
    })),
  };
}

export interface BillEstimateResult {
  breakdown: CostBreakdown;
  tariff: ActiveTariff | null;
  projection: { projectedKwh: number; projectedTotal: number };
}

export async function estimateBill(
  homeId: string,
  deviceIds: string[],
  from: Date,
  to: Date,
  now: Date = new Date(),
): Promise<BillEstimateResult> {
  const tariff = await activeTariff(homeId);
  const energyKwh = await energyTotal(deviceIds, from, to);

  if (!tariff) {
    const empty: CostBreakdown = {
      energyKwh,
      energyCost: 0,
      fixedCharge: 0,
      taxAmount: 0,
      total: 0,
      currency: 'INR',
      slabs: [],
    };
    return { breakdown: empty, tariff: null, projection: { projectedKwh: energyKwh, projectedTotal: 0 } };
  }

  const breakdown = calculateCost(energyKwh, tariff.input);
  const elapsedDays = Math.max(1, (Math.min(now.getTime(), to.getTime()) - from.getTime()) / 86_400_000);
  const monthDays = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const projection = projectMonthly(energyKwh, elapsedDays, monthDays, tariff.input);

  return { breakdown, tariff, projection };
}

export interface InsightInput {
  currentKwh: number;
  previousKwh: number;
  peakPowerW: number;
  baseLoadW: number;
  dailyThresholdKwh: number | null;
}

/** Deterministic, data-backed observations — no invented savings figures. */
export function buildInsights(input: InsightInput): Insight[] {
  const insights: Insight[] = [];

  if (input.previousKwh > 0) {
    const change = ((input.currentKwh - input.previousKwh) / input.previousKwh) * 100;
    if (Math.abs(change) >= 10) {
      insights.push({
        id: 'period-comparison',
        severity: Math.abs(change) >= 25 ? 'warning' : 'info',
        title: change > 0 ? 'Consumption is up' : 'Consumption is down',
        description: `This period used ${Math.abs(change).toFixed(0)}% ${change > 0 ? 'more' : 'less'} energy than the previous period (${input.currentKwh.toFixed(1)} vs ${input.previousKwh.toFixed(1)} kWh).`,
        metric: `${change > 0 ? '+' : ''}${change.toFixed(0)}%`,
      });
    }
  }

  if (input.peakPowerW > 0) {
    insights.push({
      id: 'peak-power',
      severity: input.peakPowerW > 4000 ? 'warning' : 'info',
      title: 'Peak demand recorded',
      description: `Peak draw reached ${(input.peakPowerW / 1000).toFixed(2)} kW. Staggering high-power appliances avoids overlapping peaks.`,
      metric: `${(input.peakPowerW / 1000).toFixed(2)} kW`,
    });
  }

  if (input.baseLoadW > 0) {
    const monthlyKwh = (input.baseLoadW * 24 * 30) / 1000;
    insights.push({
      id: 'base-load',
      severity: input.baseLoadW > 300 ? 'warning' : 'info',
      title: 'Standby load',
      description: `Your lowest observed draw is about ${input.baseLoadW.toFixed(0)} W, roughly ${monthlyKwh.toFixed(0)} kWh a month if it ran constantly.`,
      metric: `${input.baseLoadW.toFixed(0)} W`,
    });
  }

  if (input.dailyThresholdKwh != null && input.currentKwh > input.dailyThresholdKwh) {
    insights.push({
      id: 'threshold',
      severity: 'warning',
      title: 'Daily target exceeded',
      description: `You used ${input.currentKwh.toFixed(1)} kWh against a daily target of ${input.dailyThresholdKwh.toFixed(1)} kWh.`,
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: 'no-anomaly',
      severity: 'info',
      title: 'Nothing unusual detected',
      description: 'Consumption is within the expected range for the selected period.',
    });
  }

  return insights;
}
