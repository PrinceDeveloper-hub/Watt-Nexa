import { calculateCost } from './tariff';
import type { CostBreakdown, TariffSlabInput } from '@wattnexa/types';

export type DateInput = Date | string | number;

export interface TariffVersion {
  id: string;
  distributor?: string | null;
  effectiveFrom: DateInput;
  effectiveTo?: DateInput | null;
  slabs: TariffSlabInput[];
  fixedCharge: number;
  dutyRate: number;
  sourceReference?: string | null;
}

export interface BillForAnalysis {
  id?: string;
  householdId?: string;
  billingStart: DateInput;
  billingEnd: DateInput;
  units: number;
  amount: number;
  fixedCharge: number;
  duty: number;
  rebate: number;
  distributor?: string | null;
  tariffVersion?: TariffVersion | null;
  tariffVersionId?: string | null;
}

export type Confidence = 'measured' | 'user-entered' | 'estimated' | 'unavailable';

export interface AnalysisComponent {
  key: 'consumption' | 'tariff' | 'period' | 'fixedCharge' | 'duty' | 'rebate' | 'interaction';
  label: string;
  amount: number | null;
  inputs: Record<string, unknown>;
  formula: string;
  tariffVersionId: string | null;
  confidence: Confidence;
}

export interface BillChangeAnalysis {
  billAId: string | null;
  billBId: string | null;
  totalDifference: number;
  hasEnoughData: boolean;
  components: AnalysisComponent[];
  interactionIncluded: boolean;
  deterministicExplanation: string;
}

const PAISE = 100;

function toPaise(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * PAISE);
}

function fromPaise(value: number): number {
  return Math.round(value) / PAISE;
}

function toDate(value: DateInput): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date');
  return date;
}

export function periodDays(start: DateInput, end: DateInput): number {
  const from = toDate(start);
  const to = toDate(end);
  const diff = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  return Math.max(1, diff + 1);
}

export function toTariffInput(version: TariffVersion): { currency: string; fixedCharge: number; taxPercent: number; slabs: TariffSlabInput[] } {
  return {
    currency: 'INR',
    fixedCharge: version.fixedCharge,
    taxPercent: version.dutyRate,
    slabs: version.slabs,
  };
}

export function findTariffVersion(versions: TariffVersion[], date: DateInput): TariffVersion | null {
  const target = toDate(date).getTime();
  for (const version of versions) {
    const from = toDate(version.effectiveFrom).getTime();
    const to = version.effectiveTo == null ? Number.POSITIVE_INFINITY : toDate(version.effectiveTo).getTime();
    if (target >= from && target <= to) return version;
  }
  return null;
}

export function splitPeriodByTariff(
  start: DateInput,
  end: DateInput,
  versions: TariffVersion[],
): Array<{ start: Date; end: Date; days: number; version: TariffVersion | null }> {
  const fromDate = toDate(start);
  const toDateValue = toDate(end);
  const boundaries = new Set<number>([fromDate.getTime(), toDateValue.getTime()]);
  for (const version of versions) {
    const from = toDate(version.effectiveFrom).getTime();
    const to = version.effectiveTo == null ? Number.POSITIVE_INFINITY : toDate(version.effectiveTo).getTime();
    if (from > fromDate.getTime() && from < toDateValue.getTime()) boundaries.add(from);
    if (Number.isFinite(to)) {
      const exclusiveEnd = to + 86_400_000;
      if (exclusiveEnd > fromDate.getTime() && exclusiveEnd < toDateValue.getTime()) boundaries.add(exclusiveEnd);
    }
  }
  const sorted = [...boundaries].filter(Number.isFinite).sort((a, b) => a - b);
  const segments: Array<{ start: Date; end: Date; days: number; version: TariffVersion | null }> = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const segmentStart = new Date(sorted[index]!);
    const segmentEnd = new Date(sorted[index + 1]!);
    // Convert the half-open segment back to an inclusive day range.
    const inclusiveEnd = new Date(segmentEnd.getTime() - 86_400_000);
    const midpoint = new Date((segmentStart.getTime() + segmentEnd.getTime()) / 2);
    const version = findTariffVersion(versions, midpoint);
    const days = Math.max(1, Math.round((segmentEnd.getTime() - segmentStart.getTime()) / 86_400_000));
    segments.push({ start: segmentStart, end: inclusiveEnd < segmentStart ? segmentStart : inclusiveEnd, days, version });
  }
  if (segments.length === 0) {
    segments.push({ start: fromDate, end: toDateValue, days: periodDays(fromDate, toDateValue), version: findTariffVersion(versions, fromDate) });
  }
  return segments;
}

function energyCostPaise(
  units: number,
  start: DateInput,
  end: DateInput,
  explicitVersion: TariffVersion | null | undefined,
  versions: TariffVersion[],
): number | null {
  if (explicitVersion) {
    return toPaise(calculateCost(Math.max(0, units), toTariffInput(explicitVersion)).energyCost);
  }

  const segments = splitPeriodByTariff(start, end, versions);
  if (segments.some((segment) => segment.version == null)) return null;

  const totalDays = segments.reduce((sum, segment) => sum + segment.days, 0);
  if (totalDays <= 0) return null;

  let total = 0;
  for (const segment of segments) {
    const segmentUnits = (Math.max(0, units) * segment.days) / totalDays;
    total += toPaise(calculateCost(segmentUnits, toTariffInput(segment.version!)).energyCost);
  }
  return total;
}

export function hasTariffCoverage(start: DateInput, end: DateInput, versions: TariffVersion[]): boolean {
  const explicit = false;
  return energyCostPaise(1, start, end, explicit ? null : undefined, versions) !== null;
}

export function analyzeBillChange(
  billA: BillForAnalysis,
  billB: BillForAnalysis,
  tariffVersions: TariffVersion[] = [],
): BillChangeAnalysis {
  const versions = tariffVersions;
  const daysA = periodDays(billA.billingStart, billA.billingEnd);
  const daysB = periodDays(billB.billingStart, billB.billingEnd);
  const dailyA = billA.units / daysA;
  const dailyB = billB.units / daysB;

  const consumptionUnits = dailyB * daysA;
  const periodUnits = dailyB * daysB;

  const energyA = energyCostPaise(billA.units, billA.billingStart, billA.billingEnd, billA.tariffVersion, versions);
  const energyConsumption = energyCostPaise(consumptionUnits, billA.billingStart, billA.billingEnd, billA.tariffVersion, versions);
  const energyTariff = energyCostPaise(consumptionUnits, billA.billingStart, billA.billingEnd, billB.tariffVersion, versions);
  const energyPeriod = energyCostPaise(periodUnits, billB.billingStart, billB.billingEnd, billB.tariffVersion, versions);

  const enoughData = energyA !== null && energyConsumption !== null && energyTariff !== null && energyPeriod !== null;

  const fixedA = toPaise(billA.fixedCharge);
  const fixedB = toPaise(billB.fixedCharge);
  const dutyA = toPaise(billA.duty);
  const dutyB = toPaise(billB.duty);
  const rebateA = toPaise(billA.rebate);
  const rebateB = toPaise(billB.rebate);
  const amountA = toPaise(billA.amount);
  const amountB = toPaise(billB.amount);

  const consumptionAmount = enoughData ? (energyConsumption! - energyA!) : null;
  const tariffAmount = enoughData ? (energyTariff! - energyConsumption!) : null;
  const periodAmount = enoughData ? (energyPeriod! - energyTariff!) : null;
  const fixedAmount = fixedB - fixedA;
  const dutyAmount = dutyB - dutyA;
  const rebateAmount = rebateA - rebateB;

  const energyDifference = enoughData ? (energyPeriod! - energyA!) : 0;
  const fieldDifference = fixedAmount + dutyAmount + rebateAmount;
  const interactionAmount = enoughData
    ? (amountB - amountA) - (energyDifference + fieldDifference)
    : null;

  const tariffVersionIdA = billA.tariffVersion?.id ?? billA.tariffVersionId ?? null;
  const tariffVersionIdB = billB.tariffVersion?.id ?? billB.tariffVersionId ?? null;

  const components: AnalysisComponent[] = [
    {
      key: 'consumption',
      label: 'Consumption',
      amount: consumptionAmount === null ? null : fromPaise(consumptionAmount),
      inputs: {
        baselineUnits: billA.units,
        comparisonUnits: billB.units,
        baselineDays: daysA,
        comparisonDays: daysB,
        baselineDailyUnits: dailyA,
        comparisonDailyUnits: dailyB,
        consumptionScenarioUnits: consumptionUnits,
      },
      formula: '(comparison daily units - baseline daily units) × baseline days, priced at the baseline tariff',
      tariffVersionId: tariffVersionIdA,
      confidence: enoughData ? 'user-entered' : 'unavailable',
    },
    {
      key: 'tariff',
      label: 'Tariff revision',
      amount: tariffAmount === null ? null : fromPaise(tariffAmount),
      inputs: {
        scenarioUnits: consumptionUnits,
        baselineTariffVersionId: tariffVersionIdA,
        comparisonTariffVersionId: tariffVersionIdB,
      },
      formula: 'Same consumption, repriced under the comparison tariff version',
      tariffVersionId: tariffVersionIdB,
      confidence: enoughData ? 'estimated' : 'unavailable',
    },
    {
      key: 'period',
      label: 'Billing-period length',
      amount: periodAmount === null ? null : fromPaise(periodAmount),
      inputs: {
        baselineDays: daysA,
        comparisonDays: daysB,
        comparisonDailyUnits: dailyB,
        comparisonScenarioUnits: periodUnits,
      },
      formula: 'Comparison daily units × (comparison days - baseline days), priced at the comparison tariff',
      tariffVersionId: tariffVersionIdB,
      confidence: enoughData ? 'measured' : 'unavailable',
    },
    {
      key: 'fixedCharge',
      label: 'Fixed charges',
      amount: fromPaise(fixedAmount),
      inputs: { baselineFixedCharge: billA.fixedCharge, comparisonFixedCharge: billB.fixedCharge },
      formula: 'comparison fixed charge - baseline fixed charge',
      tariffVersionId: tariffVersionIdB,
      confidence: 'user-entered',
    },
    {
      key: 'duty',
      label: 'Duty',
      amount: fromPaise(dutyAmount),
      inputs: { baselineDuty: billA.duty, comparisonDuty: billB.duty },
      formula: 'comparison duty - baseline duty',
      tariffVersionId: tariffVersionIdB,
      confidence: 'user-entered',
    },
    {
      key: 'rebate',
      label: 'Rebates',
      amount: fromPaise(rebateAmount),
      inputs: { baselineRebate: billA.rebate, comparisonRebate: billB.rebate },
      formula: 'baseline rebate - comparison rebate',
      tariffVersionId: tariffVersionIdB,
      confidence: 'user-entered',
    },
    {
      key: 'interaction',
      label: 'Interaction',
      amount: interactionAmount === null ? null : fromPaise(interactionAmount),
      inputs: {
        totalDifference: fromPaise(amountB - amountA),
        energyDifference: enoughData ? fromPaise(energyDifference) : null,
        fieldDifference: fromPaise(fieldDifference),
      },
      formula: 'bill difference - (consumption + tariff + period + fixed + duty + rebate)',
      tariffVersionId: null,
      confidence: enoughData ? 'estimated' : 'unavailable',
    },
  ];

  const analysis: BillChangeAnalysis = {
    billAId: billA.id ?? null,
    billBId: billB.id ?? null,
    totalDifference: fromPaise(amountB - amountA),
    hasEnoughData: enoughData,
    components,
    interactionIncluded: interactionAmount !== null && interactionAmount !== 0,
    deterministicExplanation: '',
  };
  analysis.deterministicExplanation = buildBillAnalysisExplanation(analysis);
  return analysis;
}

export function buildBillAnalysisExplanation(analysis: BillChangeAnalysis): string {
  if (!analysis.hasEnoughData) {
    return 'Not enough data to analyse this change: a tariff version is missing for at least one billing date.';
  }
  const parts = analysis.components
    .filter((component) => component.key !== 'interaction' && component.amount !== null && component.amount !== 0)
    .map((component) => `${component.label.toLowerCase()} ${component.amount! >= 0 ? '+' : ''}${component.amount!.toFixed(2)}`);
  const interaction = analysis.components.find((component) => component.key === 'interaction');
  const interactionText =
    analysis.interactionIncluded && interaction?.amount
      ? ` An interaction term of ${interaction.amount >= 0 ? '+' : ''}${interaction.amount.toFixed(2)} captures the remaining non-additive effect.`
      : '';
  return `The bill changed by ${analysis.totalDifference >= 0 ? '+' : ''}${analysis.totalDifference.toFixed(2)}, driven by ${parts.length ? parts.join(', ') : 'no single component'}.${interactionText}`;
}

export const analyzeTwoBills = analyzeBillChange;
export const analyzeBills = analyzeBillChange;
export const rootCauseAnalysis = analyzeBillChange;
export const compareBills = analyzeBillChange;
export const billRootCause = analyzeBillChange;
export const billChangeAnalysis = analyzeBillChange;
