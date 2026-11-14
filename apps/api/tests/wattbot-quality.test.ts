import { describe, expect, it } from 'vitest';
import { ruleBasedAnswer } from '../src/services/wattbot/answer';
import type { WattbotFacts } from '../src/services/wattbot/tools';

/**
 * Regression dataset for the deterministic answer path. These assertions are
 * about honesty, not phrasing: no invented readings, no appliance attribution,
 * no bill without a tariff, and no "0 kWh" when the meter simply has no data.
 */

function facts(overrides: Partial<WattbotFacts> = {}): WattbotFacts {
  return {
    home: { id: 'home-1', name: 'Demo household', timezone: 'Asia/Kolkata' },
    devices: [],
    usage: {
      todayKwh: 0,
      yesterdayKwh: 0,
      last7Kwh: 0,
      previous7Kwh: 0,
      monthKwh: 0,
      previousMonthKwh: 0,
      previousMonthToDateKwh: 0,
      last30Kwh: 0,
      peakPowerW: 0,
      peakAt: null,
      peakDayKwh: 0,
      peakDay: null,
      daily: [],
      samples: 0,
      firstReadingAt: null,
      lastReadingAt: null,
    },
    bill: null,
    tariffMissing: true,
    dataSource: 'none',
    staleDevices: [],
    ...overrides,
  };
}

const device = {
  id: 'device-1',
  name: 'Main Meter',
  status: 'online',
  lastSeenAt: '2026-11-14T10:00:00.000Z',
  lastReadingAt: '2026-11-14T10:00:00.000Z',
  firmwareVersion: '1.2.0',
  sensors: ['activePower', 'voltage'] as Array<'activePower' | 'voltage'>,
  reading: {
    activePowerW: 620,
    voltageV: 230,
    temperatureC: 31,
    source: 'simulated',
    recordedAt: '2026-11-14T10:00:00.000Z',
  },
};

describe('WattBot deterministic answer quality', () => {
  it('guides device setup instead of inventing usage before a device exists', () => {
    const answer = ruleBasedAnswer('How much energy did I use today?', facts());
    expect(answer).toContain('No device is paired');
    expect(answer).not.toMatch(/\d+(\.\d+)?\s*kWh/);
  });

  it('reports no stored readings rather than 0 kWh', () => {
    const answer = ruleBasedAnswer(
      'How much energy did I use today?',
      facts({ devices: [device], dataSource: 'simulated' }),
    );
    expect(answer).toContain('no stored readings');
    expect(answer).not.toContain('0.0 kWh');
  });

  it('asks for a tariff instead of guessing a rate', () => {
    const answer = ruleBasedAnswer(
      'What is my bill this month?',
      facts({
        devices: [device],
        dataSource: 'simulated',
        usage: { ...facts().usage, samples: 12, monthKwh: 42, todayKwh: 1.4 },
      }),
    );
    expect(answer).toContain('no electricity tariff is configured');
    expect(answer).toContain('Billing → Tariff');
    expect(answer).not.toMatch(/₹\s?\d/);
  });

  it('refuses appliance-level attribution from one whole-house CT', () => {
    const answer = ruleBasedAnswer(
      'Why is my usage higher — which appliance used the most energy?',
      facts({
        devices: [device],
        dataSource: 'simulated',
        usage: { ...facts().usage, samples: 12, last7Kwh: 9.5, monthKwh: 42 },
      }),
    );
    expect(answer).toContain('cannot attribute');
    expect(answer).toContain('whole-house CT');
  });

  it('labels simulated data and never calls it a real meter reading', () => {
    const answer = ruleBasedAnswer(
      'Explain my last seven days.',
      facts({
        devices: [device],
        dataSource: 'simulated',
        usage: {
          ...facts().usage,
          samples: 28,
          last7Kwh: 9.5,
          daily: [{ date: '2026-11-14', energyKwh: 1.2, peakPowerW: 620 }],
        },
      }),
    );
    expect(answer).toContain('simulated demo readings');
    expect(answer).toContain('1.2');
  });

  it('treats an empty custom date window as missing data', () => {
    const answer = ruleBasedAnswer(
      'How much did I use between 2026-10-01 and 2026-10-03?',
      facts({
        devices: [device],
        dataSource: 'simulated',
        custom: {
          ok: true,
          label: '2026-10-01 to 2026-10-03',
          from: '2026-10-01T00:00:00.000Z',
          to: '2026-10-04T00:00:00.000Z',
          bucket: 'day',
          days: 3,
          energyKwh: 0,
          peakPowerW: 0,
          samples: 0,
          daily: [],
          previousKwh: null,
          previousLabel: null,
        },
      }),
    );
    expect(answer).toContain('No readings are stored');
    expect(answer).not.toContain('**0.0 kWh**');
  });
});
