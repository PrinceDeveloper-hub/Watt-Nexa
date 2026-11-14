import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { resolveRange, type RangePreset } from '@wattnexa/shared';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, ok, queryString } from '../utils/http';
import { accessibleDevices, requireHomeAccess } from '../lib/ownership';
import { activeTariff, energySeries, energyTotal, estimateBill } from '../services/energy';
import { notFound } from '../utils/errors';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

async function scope(req: { query: Record<string, unknown>; auth?: { userId: string } }) {
  const userId = req.auth!.userId;
  const homeId = queryString(req.query.homeId);
  if (homeId) await requireHomeAccess(userId, homeId);
  const devices = await accessibleDevices(userId, homeId);
  if (devices.length === 0) throw notFound('No devices to report on', 'NO_DEVICES');
  const presetRaw = queryString(req.query.range) ?? 'last_30_days';
  const preset = presetRaw as RangePreset;
  const range = resolveRange(preset);
  return { homeId: homeId ?? devices[0]!.homeId, deviceIds: devices.map((d) => d.id), range, preset };
}

reportsRouter.get(
  '/consumption',
  asyncHandler(async (req, res) => {
    const { homeId, deviceIds, range } = await scope(req as never);
    const series = await energySeries(deviceIds, range.from, range.to, 'day');
    return ok(res, { homeId, series, from: range.from.toISOString(), to: range.to.toISOString() });
  }),
);

reportsRouter.get(
  '/consumption.csv',
  asyncHandler(async (req, res) => {
    const { deviceIds, range } = await scope(req as never);
    const series = await energySeries(deviceIds, range.from, range.to, 'day');
    const lines = [
      'date,energy_kwh,average_power_w,peak_power_w,samples',
      ...series.map((point) =>
        [point.timestamp.slice(0, 10), point.energyKwh, point.averagePowerW, point.peakPowerW, point.samples].join(','),
      ),
    ];
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader(
      'content-disposition',
      `attachment; filename="wattnexa-consumption-${range.from.toISOString().slice(0, 10)}.csv"`,
    );
    res.send(lines.join('\n'));
  }),
);

reportsRouter.get(
  '/consumption.pdf',
  asyncHandler(async (req, res) => {
    const { homeId, deviceIds, range } = await scope(req as never);
    const [series, tariff, bill] = await Promise.all([
      energySeries(deviceIds, range.from, range.to, 'day'),
      activeTariff(homeId),
      estimateBill(homeId, deviceIds, range.from, range.to),
    ]);
    const totalKwh = await energyTotal(deviceIds, range.from, range.to);

    res.setHeader('content-type', 'application/pdf');
    res.setHeader(
      'content-disposition',
      `attachment; filename="wattnexa-report-${range.from.toISOString().slice(0, 10)}.pdf"`,
    );

    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    doc.pipe(res);
    doc.fontSize(20).fillColor('#0F172A').text('WattNexa energy report');
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#64748B').text('Know exactly where your electricity bill is going.');
    doc.moveDown();
    doc.fontSize(11).fillColor('#0F172A').text(`Period: ${range.from.toISOString().slice(0, 10)} → ${range.to.toISOString().slice(0, 10)}`);
    if (tariff) doc.text(`Tariff: ${tariff.name}${tariff.provider ? ` (${tariff.provider})` : ''}`);
    doc.moveDown();

    doc.fontSize(13).text('Summary');
    doc.fontSize(10).fillColor('#334155');
    doc.text(`Total energy: ${totalKwh.toFixed(2)} kWh`);
    doc.text(`Estimated cost: ${bill.breakdown.total.toFixed(2)} ${bill.breakdown.currency}`);
    doc.text(`Energy charge: ${bill.breakdown.energyCost.toFixed(2)}`);
    doc.text(`Fixed charge: ${bill.breakdown.fixedCharge.toFixed(2)}`);
    doc.text(`Tax: ${bill.breakdown.taxAmount.toFixed(2)}`);
    doc.moveDown();

    doc.fontSize(13).fillColor('#0F172A').text('Daily consumption');
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#334155');
    for (const point of series.slice(-31)) {
      doc.text(`${point.timestamp.slice(0, 10)}   ${point.energyKwh.toFixed(2)} kWh   peak ${point.peakPowerW.toFixed(0)} W`);
    }

    doc.moveDown();
    doc.fontSize(8).fillColor('#94A3B8').text(
      `Generated ${new Date().toISOString()} by WattNexa. Costs are estimates from your configured tariff; your provider's bill remains authoritative.`,
    );
    doc.end();
  }),
);
