import type { CostBreakdown, TariffInput, TariffSlabInput } from '@wattnexa/types';

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

/** Slabs must be applied in ascending order of their starting unit. */
export function normaliseSlabs(slabs: TariffSlabInput[]): TariffSlabInput[] {
  return [...slabs].sort((a, b) => a.minKwh - b.minKwh);
}

/**
 * Progressive (block) tariff calculation, the structure used by most Indian
 * state electricity boards: each slab applies only to the units that fall
 * inside it, and fixed charges + tax apply to the whole bill.
 *
 * `energyKwh` is treated as a cumulative period total, not a marginal rate.
 */
export function calculateCost(energyKwh: number, tariff: TariffInput): CostBreakdown {
  const energy = Number.isFinite(energyKwh) ? Math.max(0, energyKwh) : 0;
  const slabs = normaliseSlabs(tariff.slabs);

  let remaining = energy;
  let energyCost = 0;
  const applied: CostBreakdown['slabs'] = [];

  for (const slab of slabs) {
    if (remaining <= 0) break;
    const span = slab.maxKwh == null ? Number.POSITIVE_INFINITY : Math.max(0, slab.maxKwh - slab.minKwh);
    const used = Math.min(remaining, span);
    if (used <= 0) continue;

    const cost = used * slab.ratePerKwh;
    energyCost += cost;
    remaining -= used;
    applied.push({
      label: `${slab.minKwh}–${slab.maxKwh ?? '∞'} kWh`,
      kwh: round(used, 3),
      ratePerKwh: slab.ratePerKwh,
      cost: round(cost),
    });
  }

  // Units above the highest slab are charged at the last slab's rate rather
  // than silently dropped.
  if (remaining > 0 && slabs.length > 0) {
    const last = slabs[slabs.length - 1] as TariffSlabInput;
    const cost = remaining * last.ratePerKwh;
    energyCost += cost;
    applied.push({
      label: `>${last.minKwh} kWh`,
      kwh: round(remaining, 3),
      ratePerKwh: last.ratePerKwh,
      cost: round(cost),
    });
  }

  const fixedCharge = Math.max(0, tariff.fixedCharge);
  const taxAmount = ((energyCost + fixedCharge) * Math.max(0, tariff.taxPercent)) / 100;

  return {
    energyKwh: round(energy, 3),
    energyCost: round(energyCost),
    fixedCharge: round(fixedCharge),
    taxAmount: round(taxAmount),
    total: round(energyCost + fixedCharge + taxAmount),
    currency: tariff.currency,
    slabs: applied,
  };
}

/**
 * Straight-line projection of a partial period to a full month.
 * Explicitly a projection — never presented as a final bill.
 */
export function projectMonthly(
  energyKwh: number,
  elapsedDays: number,
  daysInMonth: number,
  tariff: TariffInput,
): { projectedKwh: number; projectedTotal: number } {
  if (elapsedDays <= 0 || daysInMonth <= 0) {
    return { projectedKwh: 0, projectedTotal: calculateCost(0, tariff).total };
  }
  const ratePerDay = energyKwh / elapsedDays;
  const projectedKwh = ratePerDay * daysInMonth;
  return {
    projectedKwh: round(projectedKwh, 3),
    projectedTotal: calculateCost(projectedKwh, tariff).total,
  };
}
