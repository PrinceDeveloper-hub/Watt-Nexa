import { Router } from 'express';
import { resolveRange, isRangePreset, type RangePreset } from '@wattnexa/shared';
import type { Bucket } from '@wattnexa/types';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, ok, queryString } from '../utils/http';
import { accessibleDevices, requireHomeAccess } from '../lib/ownership';
import { activeTariff, buildInsights, energySeries, energyTotal, estimateBill } from '../services/energy';
import { latestReading } from '../services/telemetry';
import { notFound } from '../utils/errors';

export const energyRouter = Router();
energyRouter.use(requireAuth);

interface RequestedRange {
  from: Date;
  to: Date;
  preset: RangePreset;
}

function requestedRange(query: Record<string, unknown>): RequestedRange {
  const presetRaw = queryString(query.range) ?? 'last_7_days';
  const preset: RangePreset = isRangePreset(presetRaw) ? presetRaw : 'last_7_days';

  if (preset === 'custom') {
    const from = queryString(query.from);
    const to = queryString(query.to);
    if (from && to) {
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (!Number.isNaN(fromDate.getTime()) && !Number.isNaN(toDate.getTime()) && fromDate < toDate) {
        return { from: fromDate, to: toDate, preset };
      }
    }
  }
  const resolved = resolveRange(preset);
  return { from: resolved.from, to: resolved.to, preset };
}

function autoBucket(range: RequestedRange): Bucket {
  const hours = (range.to.getTime() - range.from.getTime()) / 3_600_000;
  if (hours <= 48) return 'hour';
  if (hours <= 24 * 92) return 'day';
  return 'day';
}

async function homeIdFrom(query: Record<string, unknown>, userId: string): Promise<string> {
  const homeId = queryString(query.homeId);
  if (homeId) {
    await requireHomeAccess(userId, homeId);
    return homeId;
  }
  const [first] = await accessibleDevices(userId);
  if (!first) throw notFound('No household found for this account', 'NO_HOME');
  return first.homeId;
}

energyRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const homeId = await homeIdFrom(req.query as Record<string, unknown>, userId);
    const range = requestedRange(req.query as Record<string, unknown>);
    const devices = await accessibleDevices(userId, homeId);
    const deviceIds = devices.map((d) => d.id);

    const now = new Date();
    const today = resolveRange('today');
    const month = resolveRange('this_month');
    const previousMonth = resolveRange('previous_month');
    const bucket = autoBucket(range);

    const [series, todayKwh, monthKwh, previousMonthKwh, tariff] = await Promise.all([
      energySeries(deviceIds, range.from, range.to, bucket),
      energyTotal(deviceIds, today.from, now),
      energyTotal(deviceIds, month.from, now),
      energyTotal(deviceIds, previousMonth.from, previousMonth.to),
      activeTariff(homeId),
    ]);

    const bill = await estimateBill(homeId, deviceIds, month.from, now, now);

    const live = await Promise.all(
      devices.map(async (device) => ({
        deviceId: device.id,
        deviceName: device.name,
        status: device.status,
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        reading: await latestReading(device.id),
      })),
    );

    const peakPowerW = series.reduce((max, point) => Math.max(max, point.peakPowerW), 0);
    const baseLoadCandidates = series.filter((point) => point.averagePowerW > 0).map((p) => p.averagePowerW);
    const baseLoadW = baseLoadCandidates.length ? Math.min(...baseLoadCandidates) : 0;

    const insights = buildInsights({
      currentKwh: series.reduce((sum, p) => sum + p.energyKwh, 0),
      previousKwh: previousMonthKwh,
      peakPowerW,
      baseLoadW,
      dailyThresholdKwh: null,
    });

    const simulated = live.some((entry) => entry.reading?.source === 'simulated');

    return ok(res, {
      homeId,
      range: { preset: range.preset, from: range.from.toISOString(), to: range.to.toISOString(), bucket },
      live,
      totals: {
        todayKwh,
        monthKwh,
        previousMonthKwh,
        monthToDateCost: bill.breakdown.total,
        projectedMonthlyKwh: bill.projection.projectedKwh,
        projectedMonthlyCost: bill.projection.projectedTotal,
      },
      series,
      bill,
      insights,
      simulated,
      deviceCount: devices.length,
      onlineCount: devices.filter((d) => d.status === 'online').length,
      tariff: tariff
        ? { id: tariff.id, name: tariff.name, provider: tariff.provider, currency: tariff.currency }
        : null,
      generatedAt: new Date().toISOString(),
    });
  }),
);

energyRouter.get(
  '/series',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const homeId = await homeIdFrom(req.query as Record<string, unknown>, userId);
    const range = requestedRange(req.query as Record<string, unknown>);
    const override = queryString(req.query.bucket);
    const bucket: Bucket =
      override === 'hour' || override === 'day' || override === 'month' ? override : autoBucket(range);

    const devices = await accessibleDevices(userId, homeId);
    const series = await energySeries(
      devices.map((d) => d.id),
      range.from,
      range.to,
      bucket,
    );
    return ok(res, { series, range: { ...range, from: range.from.toISOString(), to: range.to.toISOString() }, bucket });
  }),
);

energyRouter.get(
  '/comparison',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const homeId = await homeIdFrom(req.query as Record<string, unknown>, userId);
    const devices = await accessibleDevices(userId, homeId);
    const deviceIds = devices.map((d) => d.id);

    const thisMonth = resolveRange('this_month');
    const previous = resolveRange('previous_month');
    const [currentKwh, previousKwh] = await Promise.all([
      energyTotal(deviceIds, thisMonth.from, new Date()),
      energyTotal(deviceIds, previous.from, previous.to),
    ]);
    return ok(res, {
      currentKwh,
      previousKwh,
      changePercent: previousKwh > 0 ? Number((((currentKwh - previousKwh) / previousKwh) * 100).toFixed(1)) : null,
    });
  }),
);
