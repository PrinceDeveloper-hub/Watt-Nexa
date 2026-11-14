import { db } from '@wattnexa/database';
import { eq, desc, sql, and } from 'drizzle-orm';
import { detectApplianceAnomalies } from './appliance-anomaly';

/**
 * Generate actionable alerts for appliance anomalies.
 */
export interface ApplianceAlert {
  id: string;
  applianceId: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  recommendedActions: string[];
  createdAt: Date;
  acknowledged: boolean;
}

/**
 * Format alert from anomaly result.
 */
function formatAlert(anomaly: {
  type: string;
  severity: string;
  title: string;
  description: string;
}, applianceName: string): ApplianceAlert {
  const severity = anomaly.severity;

  const messageConfigs: Record<string, Record<string, { title: string; message: string; actions: string[] }>> = {
    high_consumption: {
      critical: {
        title: 'Major consumption anomaly',
        message: 'Appliance consumption is far above expected levels. Professional servicing advised.',
        actions: ['Immediate inspection required', 'Contact qualified technician', 'Consider appliance replacement if old']
      },
      high: {
        title: 'Significant consumption increase',
        message: 'Appliance consumption is well above expected levels. Investigation recommended.',
        actions: ['Immediate inspection advised', 'Check filters and vents', 'Contact technician if persistent']
      },
      medium: {
        title: 'Increased consumption detected',
        message: 'Appliance consumption has increased significantly compared to its normal pattern.',
        actions: ['Check for changed settings', 'Inspect for potential issues', 'Monitor over 48 hours']
      },
      low: {
        title: 'Higher than expected consumption',
        message: 'Your appliance is using more energy than its baseline average.',
        actions: ['Review consumption patterns', 'Check operating settings', 'Monitor for continuation']
      }
    },
    long_operating_period: {
      critical: {
        title: 'Prolonged operation',
        message: 'Appliance operating far beyond normal expectations.',
        actions: ['Safety check recommended', 'Inspect for overheating', 'Professional assessment']
      },
      high: {
        title: 'Unusually long operating period',
        message: 'Appliance has been running well beyond expected duration.',
        actions: ['Verify normal usage', 'Check for malfunction', 'Review thermostat settings']
      },
      medium: {
        title: 'Extended operating time',
        message: 'Appliance operating longer than typical usage pattern.',
        actions: ['Review usage schedule', 'Check if operating mode is appropriate']
      },
      low: {
        title: 'Extended operating time',
        message: 'Appliance operating longer than typical usage pattern.',
        actions: ['Review usage schedule', 'Check if operating mode is appropriate']
      }
    },
    baseline_degradation: {
      high: {
        title: 'Significant degradation',
        message: 'Substantial increase in baseline consumption detected.',
        actions: ['Urgent investigation recommended', 'Review for efficiency loss', 'Professional assessment']
      },
      medium: {
        title: 'Consumption degradation',
        message: 'Baseline consumption has increased noticeably.',
        actions: ['Identify contributing factors', 'Review maintenance history', 'Consider servicing']
      },
      low: {
        title: 'Gradual consumption increase',
        message: 'Slow increase in baseline consumption over time.',
        actions: ['Monitor trend', 'Review operating conditions', 'Check for seasonal effects']
      }
    }
  };

  const config = messageConfigs[anomaly.type]?.[severity];
  if (!config) {
    return {
      id: '',
      applianceId: '',
      type: anomaly.type,
      severity: 'low',
      title: anomaly.title,
      message: anomaly.description,
      recommendedActions: ['Review the issue'],
      createdAt: new Date(),
      acknowledged: false,
    };
  }

  return {
    id: crypto.randomUUID(),
    applianceId: '',
    type: anomaly.type,
    severity: anomaly.severity,
    title: config.title,
    message: config.message,
    recommendedActions: config.actions,
    createdAt: new Date(),
    acknowledged: false,
  };
}

/**
 * Generate alerts for all appliances in a home.
 */
export async function generateHomeApplianceAlerts(
  homeId: string,
  now: Date = new Date()
): Promise<ApplianceAlert[]> {
  // Get all appliances for this home using raw SQL
  const { rows } = await db.execute(sql`
    SELECT * FROM appliances WHERE homeId = ${homeId}
  `);

  const alerts: ApplianceAlert[] = [];

  for (const appliance of rows) {
    const anomalies = await detectApplianceAnomalies(appliance.id, homeId, now);

    for (const anomaly of anomalies) {
      // Check if already have active alert of this type
      const { rows: existing } = await db.execute(sql`
        SELECT * FROM anomaly_events 
        WHERE applianceId = ${appliance.id} 
        AND status = 'active' 
        AND type = ${anomaly.type}
        LIMIT 1
      `);

      if (existing.length > 0) continue; // Skip duplicate

      const alert = formatAlert(anomaly, appliance.name || 'Appliance');
      alert.applianceId = appliance.id;
      alert.createdAt = new Date();

      alerts.push(alert);

      // Persist the anomaly event
      await db.execute(sql`
        INSERT INTO anomaly_events (id, applianceId, type, severity, title, description, status, detectedAt)
        VALUES (${crypto.randomUUID()}, ${appliance.id}, ${anomaly.type}, ${anomaly.severity}, ${anomaly.title}, ${anomaly.description}, 'active', ${new Date()})
      `);
    }
  }

  return alerts;
}

/**
 * Acknowledge an anomaly event.
 */
export async function acknowledgeAnomaly(anomalyId: string): Promise<boolean> {
  const { rows } = await db.execute(sql`
    UPDATE anomaly_events SET status = 'acknowledged', acknowledgedAt = ${new Date()} 
    WHERE id = ${anomalyId}
  `);
  return true;
}

/**
 * Resolve an anomaly event.
 */
export async function resolveAnomaly(anomalyId: string): Promise<boolean> {
  const { rows } = await db.execute(sql`
    UPDATE anomaly_events SET status = 'resolved', resolvedAt = ${new Date()} 
    WHERE id = ${anomalyId}
  `);
  return true;
}