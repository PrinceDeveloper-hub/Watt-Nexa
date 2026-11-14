import { describe, expect, it } from 'vitest';
import { aggregateSamples } from './energy';
import { calculateCost, projectMonthly } from './tariff';
import type { TariffInput, TelemetrySample } from '@wattnexa/types';

const tariff: TariffInput = {
  currency: 'INR',
  fixedCharge: 100,
  taxPercent: 5,
  slabs: [
    { minKwh: 0, maxKwh: 100, ratePerKwh: 3 },
    { minKwh: 100, maxKwh: 300, ratePerKwh: 6 },
    { minKwh: 300, maxKwh: null, ratePerKwh: 9 },
  ],
};

describe('calculateCost', () => {
  it('charges only fixed + tax when no energy is used', () => {
    const result = calculateCost(0, tariff);
    expect(result.energyCost).toBe(0);
    expect(result.fixedCharge).toBe(100);
    expect(result.taxAmount).toBe(5);
    expect(result.total).toBe(105);
  });

  it('applies progressive slabs instead of a flat rate', () => {
    const result = calculateCost(150, tariff);
    // 100 * 3 + 50 * 6 = 600
    expect(result.energyCost).toBe(600);
    expect(result.total).toBe(735);
  });

  it('applies the final rate to units above the last slab', () => {
    const result = calculateCost(400, tariff);
    // 300 + 600 + 100*9 = 1800
    expect(result.energyCost).toBe(1800);
    expect(result.slabs).toHaveLength(3);
  });

  it('is order independent', () => {
    const shuffled: TariffInput = { ...tariff, slabs: [...tariff.slabs].reverse() };
    expect(calculateCost(250, shuffled).total).toBe(calculateCost(250, tariff).total);
  });

  it('ignores negative or non-finite energy input', () => {
    expect(calculateCost(-50, tariff).energyCost).toBe(0);
    expect(calculateCost(Number.NaN, tariff).energyCost).toBe(0);
  });

  it('projects a partial month linearly', () => {
    const projection = projectMonthly(100, 10, 30, tariff);
    expect(projection.projectedKwh).toBe(300);
    expect(projection.projectedTotal).toBe(calculateCost(300, tariff).total);
  });
});

const sample = (overrides: Partial<TelemetrySample>): TelemetrySample => ({
  deviceId: 'dev-1',
  recordedAt: '2026-01-01T00:00:00.000Z',
  voltage: 230,
  current: 1,
  activePower: 230,
  apparentPower: 230,
  powerFactor: 1,
  energyKwh: null,
  temperature: 30,
  frequency: 50,
  signalStrength: -60,
  source: 'simulated',
  ...overrides,
});

describe('aggregateSamples', () => {
  it('groups samples into hourly buckets', () => {
    const points = aggregateSamples(
      [
        sample({ recordedAt: '2026-01-01T00:10:00.000Z', activePower: 100 }),
        sample({ recordedAt: '2026-01-01T00:40:00.000Z', activePower: 300 }),
        sample({ recordedAt: '2026-01-01T01:05:00.000Z', activePower: 200 }),
      ],
      'hour',
      { intervalSeconds: 60 },
    );

    expect(points).toHaveLength(2);
    expect(points[0]?.averagePowerW).toBe(200);
    expect(points[0]?.peakPowerW).toBe(300);
    expect(points[0]?.samples).toBe(2);
  });

  it('prefers cumulative energy deltas when available', () => {
    const points = aggregateSamples(
      [
        sample({ recordedAt: '2026-01-01T00:00:00.000Z', energyKwh: 10 }),
        sample({ recordedAt: '2026-01-01T00:30:00.000Z', energyKwh: 10.5 }),
      ],
      'hour',
    );
    expect(points[0]?.energyKwh).toBe(0.5);
  });

  it('never returns negative energy for a meter rollover', () => {
    const points = aggregateSamples(
      [
        sample({ recordedAt: '2026-01-01T00:00:00.000Z', energyKwh: 10 }),
        sample({ recordedAt: '2026-01-01T00:30:00.000Z', energyKwh: 2 }),
      ],
      'hour',
    );
    expect(points[0]?.energyKwh).toBeGreaterThanOrEqual(0);
  });
});
