import { describe, expect, it } from 'vitest';
import {
  buildWattbotInsight,
  notificationActions,
  notificationCategory,
} from '../src/services/notification-view';

describe('notification presentation', () => {
  it('categorises alerts without putting energy alerts under WattBot', () => {
    expect(notificationCategory('high_power')).toBe('energy');
    expect(notificationCategory('device_offline')).toBe('device');
    expect(notificationCategory('account')).toBe('account');
    expect(notificationCategory(null)).toBe('system');
  });

  it('offers energy actions and never an appliance switch', () => {
    const actions = notificationActions('high_power', { deviceId: null, hasInsight: true });
    expect(actions.map((action) => action.key)).toEqual([
      'view_energy',
      'view_recommendation',
      'ask_wattbot',
    ]);
    expect(actions.some((action) => /off|switch|control/i.test(action.key))).toBe(false);
    expect(actions.some((action) => /off|switch|control/i.test(action.label))).toBe(false);
  });

  it('links a disconnected device to its detail view and connection help', () => {
    const actions = notificationActions('device_offline', { deviceId: 'device-1' });
    expect(actions.map((action) => action.key)).toEqual([
      'view_device',
      'connection_help',
      'ask_wattbot',
    ]);
  });

  it('grounds high-power advice in the measured value and CT limitation', () => {
    const insight = buildWattbotInsight('high_power', { activePowerW: 4200, thresholdW: 3000 });
    expect(insight).toContain('4.20 kW');
    expect(insight).toContain('3000 W threshold');
    expect(insight).toContain('cannot identify which appliance');
  });

  it('does not invent an insight for alert types it cannot explain', () => {
    expect(buildWattbotInsight('firmware_update')).toBeNull();
  });
});
