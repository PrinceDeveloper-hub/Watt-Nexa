import { db } from '@wattnexa/database';
import { and, eq, gte, lt, sql, desc } from 'drizzle-orm';
import type { TelemetrySample } from '@wattnexa/types';
import { aggregateSamples, consumptionTrend, energyDelta } from '@wattnexa/shared';
import { env } from '../config';
import { logger } from '../lib/logger';

/**
 * Detect anomalies for a specific appliance based on its telemetry history.
 */
export async function detectApplianceAnomalies(
  applianceId: string,
  homeId: string,
  now: Date = new Date()
): Promise<Array<{ type: string; severity: string; title: string; description: string }>> {
  const results: Array<{ type: string; severity: string; title: string; description: string }> = [];

  // Get appliance details
  const [appliance] = await db
    .select()
    .from(sql`appliances`)
    .where(eq(sql`appliances.id`, sql.raw(applianceId)))
    .limit(1);

  if (!appliance) return results;

  // Get recent telemetry samples (last 30 days)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const recentSamples = await db
    .select()
    .from(sql`device_telemetry`)
    .where(
      and(
        gte(sql`device_telemetry.recordedAt`, sql.raw(`${thirtyDaysAgo.toISOString()}`)),
        lt(sql`device_telemetry.recordedAt`, sql.raw(`${now.toISOString()}`))
      )
    )
    .orderBy(desc(sql`device_telemetry.recordedAt`))
    .limit(200);

  if (recentSamples.length < 5) {
    results.push({
      type: 'baseline_degradation',
      severity: 'low',
      title: 'Insufficient telemetry data',
      description: 'Not enough recent readings to establish a baseline.',
    });
    return results;
  }

  // Calculate basic statistics from available samples
  const poweredSamples = recentSamples.filter(
    (s: any) => s.activePower != null && Number.isFinite(s.activePower)
  );

  if (poweredSamples.length < 5) {
    results.push({
      type: 'baseline_degradation',
      severity: 'low',
      title: 'Insufficient power data',
      description: 'Not enough readings with power measurements.',
    });
    return results;
  }

  // Calculate average power
  const totalPower = poweredSamples.reduce((sum: number, s: any) => sum + (s.activePower ?? 0), 0);
  const averagePowerW = totalPower / poweredSamples.length;
  const averageHourlyKwh = Number((averagePowerW / 1000).toFixed(3));

  // 1. Detect high consumption (above rated power threshold)
  const ratedPower = appliance.ratedPowerW || 0;
  if (ratedPower > 0 && averagePowerW > ratedPower * 1.5) {
    const percentage = ((averagePowerW / ratedPower) - 1) * 100;
    results.push({
      type: 'high_consumption',
      severity: percentage > 50 ? 'critical' : percentage > 25 ? 'high' : 'medium',
      title: 'Unusually high consumption detected',
      description: `Consumption of ${averageHourlyKwh.toFixed(2)} kWh/hour is ${percentage.toFixed(0)}% above rated power.`,
    });
  }

  // 2. Detect long operating periods (if estimated hours provided)
  const estimatedHours = appliance.estimatedHoursPerDay || 0;
  if (estimatedHours > 0) {
    // Count samples where power > 10W as "active"
    const activeCount = poweredSamples.filter((s: any) => s.activePower > 10).length;
    // Approximate hours (assuming ~12 samples per hour = 5 min intervals)
    const approximateHours = Math.max(1, Math.ceil(activeCount * 5 / 60));

    if (approximateHours > estimatedHours * 1.5) {
      const overage = ((approximateHours / estimatedHours) - 1) * 100;
      results.push({
        type: 'long_operating_period',
        severity: approximateHours > estimatedHours * 2 ? 'high' : 'medium',
        title: 'Unusually long operating period',
        description: `Operating ~${approximateHours}h vs expected ${estimatedHours}h (${overage.toFixed(0)}% over).`,
      });
    }
  }

  // 3. Detect baseline degradation (compare first half vs second half)
  const sorted = [...poweredSamples].sort(
    (a: any, b: any) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );
  const mid = Math.floor(sorted.length / 2);
  if (mid >= 3) {
    const firstHalf = sorted.slice(0, mid);
    const secondHalf = sorted.slice(mid);
    const firstAvg = firstHalf.reduce((sum: number, s: any) => sum + (s.activePower ?? 0), 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum: number, s: any) => sum + (s.activePower ?? 0), 0) / secondHalf.length;

    if (firstAvg > 0 && ((secondAvg - firstAvg) / firstAvg) * 100 > 15) {
      const degradation = ((secondAvg - firstAvg) / firstAvg) * 100;
      results.push({
        type: 'baseline_degradation',
        severity: degradation > 40 ? 'high' : 'medium',
        title: 'Baseline consumption degradation',
        description: `Consumption trend shows ${degradation.toFixed(1)}% increase over monitoring period.`,
      });
    }
  }

  return results;
}