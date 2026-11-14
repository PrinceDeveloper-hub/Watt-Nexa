import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, devices } from '@wattnexa/database';
import { resolveRange } from '@wattnexa/shared';
import type { SensorCapability } from '@wattnexa/types';
import { env } from '../../config';
import { accessibleDevices, requireHomeAccess } from '../../lib/ownership';
import { activeTariff, energySeries, energyTotal, estimateBill } from '../energy';
import { deviceSensorCapabilities, latestReading } from '../telemetry';
import type { RangeParse } from './daterange';

/**
 * WattBot never writes SQL from model output. Every fact below comes from a
 * fixed, parameterised query scoped to the authenticated user's home.
 */
export interface WattbotScope {
  userId: string;
  homeId: string;
}

export interface DeviceFact {
  id: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  lastReadingAt: string | null;
  firmwareVersion: string | null;
  sensors: SensorCapability['key'][];
  reading: {
    activePowerW: number | null;
    voltageV: number | null;
    temperatureC: number | null;
    source: string;
    recordedAt: string;
  } | null;
}

export interface UsageFacts {
  todayKwh: number;
  yesterdayKwh: number;
  last7Kwh: number;
  previous7Kwh: number;
  monthKwh: number;
  previousMonthKwh: number;
  /** Previous month up to the same elapsed point — the only fair MTD comparison. */
  previousMonthToDateKwh: number;
  last30Kwh: number;
  peakPowerW: number;
  peakAt: string | null;
  peakDayKwh: number;
  peakDay: string | null;
  daily: Array<{ date: string; energyKwh: number; peakPowerW: number }>;
  samples: number;
  firstReadingAt: string | null;
  lastReadingAt: string | null;
}

export interface BillFacts {
  currency: string;
  tariffName: string;
  provider: string | null;
  fixedCharge: number;
  taxPercent: number;
  slabs: Array<{ from: number; to: number | null; ratePerKwh: number }>;
  monthToDateKwh: number;
  energyCost: number;
  taxAmount: number;
  total: number;
  projectedKwh: number;
  projectedTotal: number;
  slabLines: Array<{ label: string; kwh: number; ratePerKwh: number; cost: number }>;
}

export type CustomRangeFacts =
  | {
      ok: true;
      label: string;
      from: string;
      to: string;
      bucket: 'day' | 'month';
      days: number;
      energyKwh: number;
      peakPowerW: number;
      samples: number;
      daily: Array<{ date: string; energyKwh: number }>;
      previousKwh: number | null;
      previousLabel: string | null;
    }
  | { ok: false; reason: 'invalid' | 'too_long'; label: string };

export interface WattbotFacts {
  home: { id: string; name: string; timezone: string };
  devices: DeviceFact[];
  usage: UsageFacts;
  bill: BillFacts | null;
  tariffMissing: boolean;
  dataSource: 'none' | 'simulated' | 'hardware' | 'mixed';
  staleDevices: string[];
  /** Present only when the question named a date range. */
  custom?: CustomRangeFacts;
}

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

export interface CollectFactsOptions {
  customRange?: RangeParse;
}

async function rangeCoverage(ids: string[], from: Date, to: Date): Promise<{ samples: number; peakPowerW: number }> {
  if (ids.length === 0) return { samples: 0, peakPowerW: 0 };
  const [rows] = (await db.execute(sql`
    SELECT COUNT(*) AS samples, MAX(active_power) AS peak
    FROM device_telemetry
    WHERE device_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      AND recorded_at >= ${from}
      AND recorded_at < ${to}
  `)) as unknown as [Array<{ samples: number; peak: number | null }>, unknown];
  return {
    samples: Number(rows[0]?.samples ?? 0),
    peakPowerW: Number(rows[0]?.peak ?? 0),
  };
}

async function buildCustomRange(
  ids: string[],
  parsed: RangeParse,
): Promise<CustomRangeFacts | undefined> {
  if (parsed.status === 'none') return undefined;
  if (parsed.status === 'invalid') return { ok: false, reason: 'invalid', label: parsed.label };
  if (parsed.status === 'too_long') return { ok: false, reason: 'too_long', label: parsed.label };

  const { from, to } = parsed;
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  const bucket: 'day' | 'month' = days > 62 ? 'month' : 'day';

  const [total, series, coverage] = await Promise.all([
    energyTotal(ids, from, to),
    ids.length ? energySeries(ids, from, to, bucket) : Promise.resolve([]),
    rangeCoverage(ids, from, to),
  ]);

  const previousFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));
  const previousCoverage = await rangeCoverage(ids, previousFrom, from);
  const previousKwh =
    previousCoverage.samples > 0 ? await energyTotal(ids, previousFrom, from) : null;

  return {
    ok: true,
    label: parsed.label,
    from: from.toISOString(),
    to: to.toISOString(),
    bucket,
    days,
    energyKwh: total,
    peakPowerW: coverage.peakPowerW,
    samples: coverage.samples,
    daily: series.map((point) => ({ date: point.timestamp, energyKwh: point.energyKwh })),
    previousKwh,
    previousLabel: previousKwh === null ? null : `${previousFrom.toISOString().slice(0, 10)} to ${new Date(from.getTime() - 86_400_000).toISOString().slice(0, 10)}`,
  };
}

export async function collectFacts(
  scope: WattbotScope,
  options: CollectFactsOptions = {},
): Promise<WattbotFacts> {
  const home = await requireHomeAccess(scope.userId, scope.homeId);
  const deviceRows = await accessibleDevices(scope.userId, scope.homeId);
  const ids = deviceRows.map((device) => device.id);

  const today = resolveRange('today');
  const yesterday = resolveRange('yesterday');
  const last7 = resolveRange('last_7_days');
  const last30 = resolveRange('last_30_days');
  const month = resolveRange('this_month');
  const previousMonth = resolveRange('previous_month');
  const now = new Date();

  const previous7From = new Date(last7.from.getTime() - 7 * 86_400_000);
  const daily = ids.length ? await energySeries(ids, last7.from, last7.to, 'day') : [];
  const elapsedMs = Math.max(0, now.getTime() - month.from.getTime());
  const previousMonthMtdTo = new Date(
    Math.min(previousMonth.from.getTime() + elapsedMs, previousMonth.to.getTime()),
  );

  const [
    todayKwh,
    yesterdayKwh,
    last7Kwh,
    previous7Kwh,
    monthKwh,
    previousMonthKwh,
    previousMonthToDateKwh,
    last30Kwh,
    bill,
    tariff,
  ] =
    await Promise.all([
      energyTotal(ids, today.from, now),
      energyTotal(ids, yesterday.from, yesterday.to),
      energyTotal(ids, last7.from, last7.to),
      energyTotal(ids, previous7From, last7.from),
      energyTotal(ids, month.from, now),
      energyTotal(ids, previousMonth.from, previousMonth.to),
      energyTotal(ids, previousMonth.from, previousMonthMtdTo),
      energyTotal(ids, last30.from, last30.to),
      estimateBill(scope.homeId, ids, month.from, month.to, now),
      activeTariff(scope.homeId),
    ]);

  let samples = 0;
  let firstReadingAt: string | null = null;
  let lastReadingAt: string | null = null;
  if (ids.length) {
    // mysql2 returns [rows, fields]; destructure the rows array explicitly.
    const [coverageRows] = (await db.execute(sql`
      SELECT MIN(recorded_at) AS first_at, MAX(recorded_at) AS last_at, COUNT(*) AS samples
      FROM device_telemetry
      WHERE device_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    `)) as unknown as [Array<{ first_at: string | null; last_at: string | null; samples: number }>, unknown];
    const row = coverageRows[0];
    samples = Number(row?.samples ?? 0);
    firstReadingAt = row?.first_at ? new Date(row.first_at).toISOString() : null;
    lastReadingAt = row?.last_at ? new Date(row.last_at).toISOString() : null;
  }

  const peakPoint = daily.reduce(
    (best, point) => (point.peakPowerW > best.peakPowerW ? point : best),
    { timestamp: '', peakPowerW: 0, energyKwh: 0, averagePowerW: 0, samples: 0 },
  );
  const peakDay = daily.reduce(
    (best, point) => (point.energyKwh > best.energyKwh ? point : best),
    { timestamp: '', peakPowerW: 0, energyKwh: 0, averagePowerW: 0, samples: 0 },
  );

  const deviceFacts: DeviceFact[] = [];
  for (const device of deviceRows.slice(0, 8)) {
    const reading = await latestReading(device.id);
    const sensors = await deviceSensorCapabilities(device.id);
    deviceFacts.push({
      id: device.id,
      name: device.name,
      status: device.status,
      lastSeenAt: iso(device.lastSeenAt),
      lastReadingAt: iso(device.lastReadingAt),
      firmwareVersion: device.firmwareVersion,
      sensors: sensors.filter((sensor) => sensor.available).map((sensor) => sensor.key),
      reading: reading
        ? {
            activePowerW: reading.activePower,
            voltageV: reading.voltage,
            temperatureC: reading.temperature,
            source: reading.source,
            recordedAt: reading.recordedAt,
          }
        : null,
    });
  }

  const sources = new Set(deviceFacts.map((device) => device.reading?.source).filter(Boolean));
  const dataSource: WattbotFacts['dataSource'] =
    sources.size === 0 ? 'none' : sources.size > 1 ? 'mixed' : sources.has('simulated') ? 'simulated' : 'hardware';

  const staleCutoff = Date.now() - env.OFFLINE_THRESHOLD_SECONDS * 1000;
  const staleDevices = deviceFacts
    .filter((device) => device.status !== 'online' || !device.lastSeenAt || Date.parse(device.lastSeenAt) < staleCutoff)
    .map((device) => device.name);

  const billFacts: BillFacts | null = tariff
    ? {
        currency: tariff.currency,
        tariffName: tariff.name,
        provider: tariff.provider,
        fixedCharge: tariff.fixedCharge,
        taxPercent: tariff.taxPercent,
        slabs: tariff.slabs.map((slab) => ({ from: slab.minKwh, to: slab.maxKwh, ratePerKwh: slab.ratePerKwh })),
        monthToDateKwh: bill.breakdown.energyKwh,
        energyCost: bill.breakdown.energyCost,
        taxAmount: bill.breakdown.taxAmount,
        total: bill.breakdown.total,
        projectedKwh: bill.projection.projectedKwh,
        projectedTotal: bill.projection.projectedTotal,
        slabLines: bill.breakdown.slabs,
      }
    : null;

  const custom = options.customRange ? await buildCustomRange(ids, options.customRange) : undefined;

  return {
    home: { id: home.id, name: home.name, timezone: home.timezone },
    devices: deviceFacts,
    ...(custom ? { custom } : {}),
    usage: {
      todayKwh,
      yesterdayKwh,
      last7Kwh,
      previous7Kwh,
      monthKwh,
      previousMonthKwh,
      previousMonthToDateKwh,
      last30Kwh,
      peakPowerW: peakPoint.peakPowerW,
      peakAt: peakPoint.timestamp || null,
      peakDayKwh: peakDay.energyKwh,
      peakDay: peakDay.timestamp || null,
      daily: daily.map((point) => ({
        date: point.timestamp,
        energyKwh: point.energyKwh,
        peakPowerW: point.peakPowerW,
      })),
      samples,
      firstReadingAt,
      lastReadingAt,
    },
    bill: billFacts,
    tariffMissing: !tariff,
    dataSource,
    staleDevices,
  };
}

/** Marked-up fact sheet for the model; every value is labelled by provenance. */
export function factsToPrompt(facts: WattbotFacts): string {
  const u = facts.usage;
  const lines: string[] = [
    `home=${facts.home.name} (timezone ${facts.home.timezone})`,
    `data_provenance=${facts.dataSource}${facts.dataSource === 'simulated' ? ' — demo readings, NOT a real meter' : ''}`,
    `samples_stored=${u.samples}; first_reading=${u.firstReadingAt ?? 'none'}; last_reading=${u.lastReadingAt ?? 'none'}`,
    '',
    'MEASURED/CALCULATED (from stored readings):',
    `today_kwh=${u.todayKwh}; yesterday_kwh=${u.yesterdayKwh}; last_7_days_kwh=${u.last7Kwh}; previous_7_days_kwh=${u.previous7Kwh}`,
    `this_month_kwh=${u.monthKwh}; last_month_kwh=${u.previousMonthKwh}; last_month_same_point_kwh=${u.previousMonthToDateKwh}; last_30_days_kwh=${u.last30Kwh}`,
    'NOTE: compare month-to-date only against last_month_same_point_kwh; the full last_month_kwh is not a like-for-like figure.',
    `peak_power_w_7d=${u.peakPowerW}; peak_at=${u.peakAt ?? 'n/a'}; highest_day_kwh=${u.peakDayKwh}; highest_day=${u.peakDay ?? 'n/a'}`,
  ];

  if (u.daily.length) {
    lines.push(
      `daily_kwh_7d=${u.daily.map((day) => `${day.date.slice(0, 10)}:${day.energyKwh}`).join(', ')}`,
    );
  }

  lines.push('', 'DEVICES:');
  if (facts.devices.length === 0) {
    lines.push('no_device_paired');
  } else {
    for (const device of facts.devices) {
      lines.push(
        `- ${device.name}: status=${device.status}; last_seen=${device.lastSeenAt ?? 'never'}; firmware=${device.firmwareVersion ?? 'unknown'}; sensors=${device.sensors.join('|') || 'none reported'}; live_power_w=${device.reading?.activePowerW ?? 'unavailable'}`,
      );
    }
  }

  if (facts.staleDevices.length) lines.push(`stale_devices=${facts.staleDevices.join(', ')}`);

  lines.push('', 'BILL (ESTIMATE from the user\'s own tariff settings, not the provider\'s bill):');
  if (!facts.bill) {
    lines.push('tariff_not_configured — do not invent a rate; ask the user to configure a tariff.');
  } else {
    lines.push(
      `tariff=${facts.bill.tariffName}; currency=${facts.bill.currency}; fixed_charge=${facts.bill.fixedCharge}; tax_percent=${facts.bill.taxPercent}`,
      `slabs=${facts.bill.slabs
        .map((slab) => `${slab.from}-${slab.to ?? '∞'}kWh @ ${slab.ratePerKwh}`)
        .join(' | ')}`,
      `month_to_date_kwh=${facts.bill.monthToDateKwh}; energy_cost=${facts.bill.energyCost}; tax=${facts.bill.taxAmount}; total_so_far=${facts.bill.total}`,
      `projected_kwh=${facts.bill.projectedKwh}; projected_total=${facts.bill.projectedTotal}`,
    );
  }

  if (facts.custom) {
    lines.push('', 'USER-REQUESTED DATE RANGE (answer this specifically):');
    if (!facts.custom.ok) {
      lines.push(
        facts.custom.reason === 'too_long'
          ? `range_too_long (${facts.custom.label}) — maximum 366 days per question; ask the user to narrow it.`
          : 'range_invalid — the dates could not be parsed; ask for an explicit window such as 2026-03-01 to 2026-03-07.',
      );
    } else {
      const c = facts.custom;
      lines.push(
        `window=${c.label} (${c.days} days); samples_stored=${c.samples}; energy_kwh=${c.energyKwh}; peak_power_w=${c.peakPowerW}`,
        c.previousKwh === null
          ? 'previous_equal_window=no stored data'
          : `previous_equal_window=${c.previousKwh} kWh (${c.previousLabel})`,
      );
      if (c.daily.length) {
        lines.push(
          `${c.bucket}_totals=${c.daily
            .slice(-31)
            .map((point) => `${point.date.slice(0, 10)}:${point.energyKwh}`)
            .join(', ')}`,
        );
      }
      if (c.samples === 0) {
        lines.push('IMPORTANT: zero stored samples for this window means the meter was not reporting. Say so; never report 0 kWh consumption.');
      }
    }
  }

  return lines.join('\n');
}

export async function deviceOwnershipCheck(userId: string, deviceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.ownerId, userId), isNull(devices.deletedAt)))
    .limit(1);
  return Boolean(row);
}

/** Samples for a custom window, used by the optional chart payload. */
export async function dailySeriesForScope(scope: WattbotScope, days: 7 | 30) {
  const deviceRows = await accessibleDevices(scope.userId, scope.homeId);
  if (deviceRows.length === 0) return [];
  const range = resolveRange(days === 7 ? 'last_7_days' : 'last_30_days');
  return energySeries(
    deviceRows.map((device) => device.id),
    range.from,
    range.to,
    'day',
  );
}

/** Keeps the model's context bounded and strips control characters. */
export function sanitiseQuestion(question: string): string {
  return question
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\s{3,}/g, '  ')
    .trim()
    .slice(0, 2000);
}
