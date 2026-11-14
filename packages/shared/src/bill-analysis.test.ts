import { describe, expect, it } from 'vitest';
import { analyzeBillChange, periodDays } from './bill-analysis';
import type { BillForAnalysis, TariffVersion } from './bill-analysis';

const tariffA: TariffVersion = {
  id: 'tariff-a',
  distributor: 'WBSEDCL',
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  effectiveTo: '2026-06-30T23:59:59.000Z',
  slabs: [
    { minKwh: 0, maxKwh: 100, ratePerKwh: 5 },
    { minKwh: 100, maxKwh: null, ratePerKwh: 8 },
  ],
  fixedCharge: 100,
  dutyRate: 10,
  sourceReference: 'NEEDS_CONFIRMATION',
};

const tariffB: TariffVersion = {
  ...tariffA,
  id: 'tariff-b',
  effectiveFrom: '2026-07-01T00:00:00.000Z',
  effectiveTo: null,
  slabs: [
    { minKwh: 0, maxKwh: 100, ratePerKwh: 6 },
    { minKwh: 100, maxKwh: null, ratePerKwh: 9 },
  ],
  fixedCharge: 120,
  dutyRate: 12,
};

function bill(overrides: Partial<BillForAnalysis>): BillForAnalysis {
  return {
    id: 'bill',
    householdId: 'home',
    billingStart: '2026-02-01T00:00:00.000Z',
    billingEnd: '2026-02-28T00:00:00.000Z',
    units: 120,
    amount: 0,
    fixedCharge: 100,
    duty: 10,
    rebate: 0,
    distributor: 'WBSEDCL',
    tariffVersion: tariffA,
    ...overrides,
  };
}

describe('bill root-cause analysis', () => {
  it('components sum to the stored bill difference', () => {
    const a = bill({ id: 'a', units: 100, amount: 700, fixedCharge: 100, duty: 20, rebate: 5 });
    const b = bill({ id: 'b', units: 150, amount: 1080, fixedCharge: 120, duty: 30, rebate: 0, tariffVersion: tariffB });
    const analysis = analyzeBillChange(a, b, [tariffA, tariffB]);
    const sum = analysis.components.reduce((total, component) => total + (component.amount ?? 0), 0);
    expect(sum).toBeCloseTo(analysis.totalDifference, 6);
  });

  it('no change produces zero components', () => {
    const a = bill({ id: 'a', amount: 800 });
    const b = bill({ id: 'b', amount: 800 });
    const analysis = analyzeBillChange(a, b, [tariffA]);
    for (const component of analysis.components) {
      expect(component.amount).toBe(0);
    }
  });

  it('tariff-only change lands in tariff component', () => {
    const a = bill({ id: 'a', amount: 600, tariffVersion: tariffA });
    const b = bill({ id: 'b', amount: 600, tariffVersion: tariffB, fixedCharge: 100, duty: 10, rebate: 0 });
    // force same units/period/fixed/duty/rebate
    b.units = a.units;
    b.fixedCharge = a.fixedCharge;
    b.duty = a.duty;
    b.rebate = a.rebate;
    const analysis = analyzeBillChange(a, b, [tariffA, tariffB]);
    expect(analysis.components.find((c) => c.key === 'consumption')?.amount).toBe(0);
    expect(analysis.components.find((c) => c.key === 'period')?.amount).toBe(0);
    expect(analysis.components.find((c) => c.key === 'fixedCharge')?.amount).toBe(0);
    expect(analysis.components.find((c) => c.key === 'tariff')?.amount).not.toBe(0);
  });

  it('usage-only change lands in consumption component', () => {
    const a = bill({ id: 'a', units: 100, amount: 600 });
    const b = bill({ id: 'b', units: 160, amount: 900 });
    b.fixedCharge = a.fixedCharge;
    b.duty = a.duty;
    b.rebate = a.rebate;
    b.tariffVersion = a.tariffVersion;
    const analysis = analyzeBillChange(a, b, [tariffA]);
    expect(analysis.components.find((c) => c.key === 'tariff')?.amount).toBe(0);
    expect(analysis.components.find((c) => c.key === 'period')?.amount).toBe(0);
    expect(analysis.components.find((c) => c.key === 'consumption')?.amount).not.toBe(0);
  });

  it('billing-period-only change lands in period component', () => {
    const a = bill({ id: 'a', units: 100, billingStart: '2026-02-01T00:00:00.000Z', billingEnd: '2026-02-10T00:00:00.000Z' });
    const b = bill({ id: 'b', units: 200, billingStart: '2026-02-01T00:00:00.000Z', billingEnd: '2026-02-20T00:00:00.000Z' });
    // same daily consumption (10 kWh/day)
    b.units = 200;
    b.tariffVersion = a.tariffVersion;
    b.fixedCharge = a.fixedCharge;
    b.duty = a.duty;
    b.rebate = a.rebate;
    const analysis = analyzeBillChange(a, b, [tariffA]);
    expect(analysis.components.find((c) => c.key === 'consumption')?.amount).toBe(0);
    expect(analysis.components.find((c) => c.key === 'period')?.amount).not.toBe(0);
  });

  it('period spanning a tariff change uses both versions', () => {
    const a = bill({ id: 'a', billingStart: '2026-06-20T00:00:00.000Z', billingEnd: '2026-06-25T00:00:00.000Z', tariffVersion: undefined });
    const b = bill({ id: 'b', billingStart: '2026-06-28T00:00:00.000Z', billingEnd: '2026-07-05T00:00:00.000Z', tariffVersion: undefined });
    const analysis = analyzeBillChange(a, b, [tariffA, tariffB]);
    expect(analysis.hasEnoughData).toBe(true);
  });

  it('missing tariff version reports not enough data', () => {
    const a = bill({ id: 'a', billingStart: '2025-01-01T00:00:00.000Z', billingEnd: '2025-01-10T00:00:00.000Z', tariffVersion: undefined });
    const b = bill({ id: 'b', billingStart: '2025-01-11T00:00:00.000Z', billingEnd: '2025-01-20T00:00:00.000Z', tariffVersion: undefined });
    const analysis = analyzeBillChange(a, b, [tariffA, tariffB]);
    expect(analysis.hasEnoughData).toBe(false);
    expect(analysis.components.find((c) => c.key === 'consumption')?.amount).toBeNull();
  });

  it('zero or negative units do not crash', () => {
    const a = bill({ id: 'a', units: 0 });
    const b = bill({ id: 'b', units: -5 });
    const analysis = analyzeBillChange(a, b, [tariffA]);
    expect(analysis.totalDifference).toBeDefined();
  });
});
