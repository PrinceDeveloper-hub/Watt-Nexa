import type {
  AlertType,
  NotificationAction,
  NotificationCategory,
} from '@wattnexa/types';

/**
 * Notification presentation is derived on the server so the popup never shows
 * an action the rest of the product cannot actually perform. In particular
 * there is no appliance switch action: WattNexa has no switching hardware.
 */

const ENERGY_ALERTS: AlertType[] = [
  'high_power',
  'unusual_consumption',
  'daily_threshold',
  'monthly_threshold',
  'bill_threshold',
  'high_temperature',
];

const CATEGORY_OVERRIDES: NotificationCategory[] = [
  'energy',
  'device',
  'wattbot',
  'automation',
  'account',
  'system',
];

export function notificationCategory(
  type: AlertType | string | null | undefined,
  metadata?: Record<string, unknown> | null,
): NotificationCategory {
  const override = metadata?.category;
  if (typeof override === 'string' && CATEGORY_OVERRIDES.includes(override as NotificationCategory)) {
    return override as NotificationCategory;
  }
  if (!type) return 'system';
  if (type === 'account') return 'account';
  if (type.startsWith('device_')) return 'device';
  if (type.startsWith('automation')) return 'automation';
  if (type.includes('wattbot')) return 'wattbot';
  if (ENERGY_ALERTS.includes(type as AlertType)) return 'energy';
  return 'system';
}

/**
 * A short, deterministic explanation attached to an alert at creation time.
 * It is grounded in the alert's own measurements and the documented hardware
 * behaviour, so it does not need a paid model call per telemetry reading.
 */
export function buildWattbotInsight(
  type: AlertType,
  metadata?: Record<string, unknown> | null,
): string | null {
  const power = typeof metadata?.activePowerW === 'number' ? metadata.activePowerW : null;
  const threshold = typeof metadata?.thresholdW === 'number' ? metadata.thresholdW : null;

  switch (type) {
    case 'high_power':
    case 'unusual_consumption':
      return [
        power != null
          ? `Live draw is ${power >= 1000 ? `${(power / 1000).toFixed(2)} kW` : `${power.toFixed(0)} W`}${threshold != null ? `, above your ${threshold.toFixed(0)} W threshold` : ''}.`
          : 'Your live draw is above the configured threshold.',
        'Check appliances that may be running longer than expected, especially heating, cooling and water heating.',
        'A single whole-house CT shows when consumption rose; it cannot identify which appliance caused it.',
      ].join(' ');
    case 'high_temperature':
      return 'The device is above its temperature limit. Check ventilation around the unit and that the CT wiring is secure. It keeps measuring, but sustained heat can shorten its life.';
    case 'device_offline':
      return 'Readings stop when a device loses power or its network connection. Check the power supply first, then the Wi-Fi and broker/API connection. Once readings resume, the dashboard and bill estimate update automatically.';
    case 'device_error':
      return 'The device reported an error. Power-cycle it and check the serial log; if the error repeats, the connection history on the device page shows when it started.';
    case 'account':
      return 'Account and plan changes take effect on your next request. Sandbox invoices are records only — they are never marked paid without a real payment capture.';
    default:
      return null;
  }
}

export function notificationActions(
  type: AlertType | string | null | undefined,
  options: { deviceId?: string | null; hasInsight?: boolean } = {},
): NotificationAction[] {
  const { deviceId, hasInsight } = options;

  if (!type) return [{ key: 'view_alerts', label: 'View alerts' }, { key: 'ask_wattbot', label: 'Ask WattBot' }];

  if (type === 'account') {
    return [
      { key: 'view_account', label: 'View account' },
      { key: 'view_alerts', label: 'View alerts' },
    ];
  }

  if (type.startsWith('device_')) {
    const actions: NotificationAction[] = [];
    if (deviceId) actions.push({ key: 'view_device', label: 'View device' });
    if (type === 'device_offline') {
      actions.push({ key: 'connection_help', label: 'Connection help' });
    }
    actions.push({ key: 'ask_wattbot', label: 'Ask WattBot' });
    return actions;
  }

  if (ENERGY_ALERTS.includes(type as AlertType)) {
    const actions: NotificationAction[] = [{ key: 'view_energy', label: 'View energy usage' }];
    if (hasInsight) actions.push({ key: 'view_recommendation', label: 'View recommendation' });
    actions.push({ key: 'ask_wattbot', label: 'Ask WattBot' });
    return actions;
  }

  return [{ key: 'view_alerts', label: 'View alerts' }, { key: 'ask_wattbot', label: 'Ask WattBot' }];
}
