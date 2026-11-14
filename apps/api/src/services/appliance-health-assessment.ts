import { db } from '@wattnexa/database';
import { eq, desc } from 'drizzle-orm';
import type { TelemetrySample } from '@wattnexa/types';
import { detectApplianceAnomalies } from './appliance-anomaly';
import { env } from '../config';

/**
 * Generate health assessment for an appliance.
 */
export interface ApplianceHealthReport {
  applianceId: string;
  healthStatus: 'normal' | 'monitoring' | 'attention_required' | 'service_recommended' | 'critical_warning' | 'insufficient_data';
  consumptionTrend: 'improving' | 'stable' | 'deteriorating';
  anomalyFrequency: number;
  lastAnomalyAt: Date | null;
  monitoringConfidence: number;
  lastCheckedAt: Date;
  readingsCount: number;
  details: Record<string, unknown>;
  recentAnomalies: Array<{ type: string; severity: string; title: string }>;
}

/**
 * Generate or update the health assessment for an appliance.
 */
export async function generateApplianceHealthAssessment(
  applianceId: string,
  homeId: string,
  now: Date = new Date()
): Promise<ApplianceHealthReport> {
  // Get appliance details
  const [appliance] = await db
    .select()
    .from(sql`appliances`)
    .where(eq(sql`appliances.id`, sql.raw(applianceId)))
    .limit(1);

  if (!appliance) {
    return {
      applianceId,
      healthStatus: 'insufficient_data',
      consumptionTrend: 'stable',
      anomalyFrequency: 0,
      lastAnomalyAt: null,
      monitoringConfidence: 0,
      lastCheckedAt: now,
      readingsCount: 0,
      details: {},
      recentAnomalies: [],
    };
  }

  // Detect current anomalies
  const currentAnomalies = await detectApplianceAnomalies(applianceId, homeId, now);

  // Count total anomalies
  const anomalyFrequency = currentAnomalies.length;

  // Determine health status based on data and anomalies
  let healthStatus: 'normal' | 'monitoring' | 'attention_required' | 'service_recommended' | 'critical_warning' | 'insufficient_data';
  let consumptionTrend: 'improving' | 'stable' | 'deteriorating';
  let monitoringConfidence = 0;

  // Calculate confidence based on data availability
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const recentSamples = await db
    .select()
    .from(sql`device_telemetry`)
    .where(
      and(
        gte(sql`device_telemetry.recordedAt`, sql.raw(`${thirtyDaysAgo.toISOString()}`)),
        lt(sql`device_telemetry.recordedAt`, sql.raw(`${now.toISOString()}`))
      )
    );

  const readingsCount = recentSamples.length;
  monitoringConfidence = readingsCount > 0 ? Math.min(1, readingsCount / 50) : 0;

  // Determine health status
  if (readingsCount < 3) {
    healthStatus = 'insufficient_data';
    consumptionTrend = 'stable';
  } else if (anomalyFrequency >= 3) {
    healthStatus = 'critical_warning';
    consumptionTrend = 'deteriorating';
  } else if (anomalyFrequency === 2) {
    healthStatus = 'service_recommended';
    consumptionTrend = 'deteriorating';
  } else if (anomalyFrequency === 1) {
    const hasCritical = currentAnomalies.some(a => a.severity === 'critical');
    healthStatus = hasCritical ? 'service_recommended' : 'attention_required';
    consumptionTrend = 'deteriorating';
  } else {
    healthStatus = 'normal';
    consumptionTrend = 'stable';
  }

  // Build details
  const details: Record<string, unknown> = {
    ratedPowerW: appliance.ratedPowerW,
    estimatedHoursPerDay: appliance.estimatedHoursPerDay,
    isMeasured: appliance.isMeasured,
    category: appliance.category,
    monitoringMethod: 'whole_house_ct', // default
  };

  // Build recent anomalies summary
  const recentAnomalies = currentAnomalies.slice(0, 3).map(a => ({
    type: a.type,
    severity: a.severity,
    title: a.title,
  }));

  return {
    applianceId,
    healthStatus,
    consumptionTrend,
    anomalyFrequency,
    lastAnomalyAt: currentAnomalies.length > 0 ? new Date() : null,
    monitoringConfidence,
    lastCheckedAt: now,
    readingsCount,
    details,
    recentAnomalies,
  };
}