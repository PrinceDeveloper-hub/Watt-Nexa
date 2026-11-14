import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, appliances, applianceUsage, electricityBills, tariffSlabs, tariffs } from '@wattnexa/database';
import { applianceSchema, calculateCost, resolveRange, tariffSchema, analyzeBillChange, type RangePreset, type BillForAnalysis, type TariffVersion } from '@wattnexa/shared';
import { requireAuth } from '../middleware/auth';
import { bodyOf, validate } from '../middleware/validate';
import { asyncHandler, created, ok } from '../utils/http';
import { accessibleDevices, requireHomeAccess } from '../lib/ownership';
import { activeTariff, energyTotal, estimateBill } from '../services/energy';

async function tariffVersionsForHome(homeId: string): Promise<TariffVersion[]> {
  const rows = await db.select().from(tariffs).where(eq(tariffs.homeId, homeId));
  return Promise.all(
    rows.map(async (row) => {
      const slabs = await db.select().from(tariffSlabs).where(eq(tariffSlabs.tariffId, row.id)).orderBy(tariffSlabs.sortOrder);
      return {
        id: row.id,
        distributor: row.distributor ?? row.provider ?? null,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        slabs: slabs.map((slab) => ({
          minKwh: slab.minKwh,
          maxKwh: slab.maxKwh,
          ratePerKwh: slab.ratePerKwh,
        })),
        fixedCharge: row.fixedCharge,
        dutyRate: row.dutyRate ?? row.taxPercent,
        sourceReference: row.sourceReference,
      } satisfies TariffVersion;
    }),
  );
}
import { newId } from '../utils/crypto';
import { badRequest, notFound } from '../utils/errors';

export const billingRouter = Router();
billingRouter.use(requireAuth);

async function resolveHome(query: Record<string, unknown>, userId: string): Promise<string> {
  const homeId = typeof query.homeId === 'string' ? query.homeId : undefined;
  if (homeId) {
    await requireHomeAccess(userId, homeId);
    return homeId;
  }
  const [device] = await accessibleDevices(userId);
  if (!device) throw notFound('No household found for this account', 'NO_HOME');
  return device.homeId;
}

// --- Tariffs ---------------------------------------------------------------

billingRouter.get(
  '/tariffs',
  asyncHandler(async (req, res) => {
    const homeId = await resolveHome(req.query as Record<string, unknown>, req.auth!.userId);
    const rows = await db.select().from(tariffs).where(eq(tariffs.homeId, homeId));
    const withSlabs = await Promise.all(
      rows.map(async (tariff) => ({
        ...tariff,
        slabs: await db.select().from(tariffSlabs).where(eq(tariffSlabs.tariffId, tariff.id)).orderBy(tariffSlabs.sortOrder),
      })),
    );
    return ok(res, withSlabs);
  }),
);

billingRouter.post(
  '/tariffs',
  validate({ body: tariffSchema }),
  asyncHandler(async (req, res) => {
    const homeId = await resolveHome(req.query as Record<string, unknown>, req.auth!.userId);
    const input = bodyOf<z.infer<typeof tariffSchema>>(req);

    const sorted = [...input.slabs].sort((a, b) => a.minKwh - b.minKwh);
    const tariffId = newId();
    await db.transaction(async (tx) => {
      await tx.update(tariffs).set({ isActive: false }).where(eq(tariffs.homeId, homeId));
      await tx.insert(tariffs).values({
        id: tariffId,
        homeId,
        name: input.name,
        provider: input.provider,
        region: input.region,
        currency: input.currency,
        fixedCharge: input.fixedCharge,
        taxPercent: input.taxPercent,
        isActive: true,
      });
      await tx.insert(tariffSlabs).values(
        sorted.map((slab, index) => ({
          id: newId(),
          tariffId,
          minKwh: slab.minKwh,
          maxKwh: slab.maxKwh,
          ratePerKwh: slab.ratePerKwh,
          sortOrder: index + 1,
        })),
      );
    });

    const tariff = await activeTariff(homeId);
    return created(res, tariff);
  }),
);

billingRouter.patch(
  '/tariffs/:tariffId',
  validate({ body: tariffSchema.partial() }),
  asyncHandler(async (req, res) => {
    const homeId = await resolveHome(req.query as Record<string, unknown>, req.auth!.userId);
    const input = bodyOf<Partial<z.infer<typeof tariffSchema>>>(req);
    const [tariff] = await db
      .select()
      .from(tariffs)
      .where(and(eq(tariffs.id, req.params.tariffId as string), eq(tariffs.homeId, homeId)))
      .limit(1);
    if (!tariff) throw notFound('Tariff not found', 'TARIFF_NOT_FOUND');

    await db
      .update(tariffs)
      .set({
        name: input.name ?? tariff.name,
        provider: input.provider ?? tariff.provider,
        region: input.region ?? tariff.region,
        fixedCharge: input.fixedCharge ?? tariff.fixedCharge,
        taxPercent: input.taxPercent ?? tariff.taxPercent,
        currency: input.currency ?? tariff.currency,
      })
      .where(eq(tariffs.id, tariff.id));

    if (input.slabs) {
      const sorted = [...input.slabs].sort((a, b) => a.minKwh - b.minKwh);
      await db.delete(tariffSlabs).where(eq(tariffSlabs.tariffId, tariff.id));
      await db.insert(tariffSlabs).values(
        sorted.map((slab, index) => ({
          id: newId(),
          tariffId: tariff.id,
          minKwh: slab.minKwh,
          maxKwh: slab.maxKwh,
          ratePerKwh: slab.ratePerKwh,
          sortOrder: index + 1,
        })),
      );
    }
    return ok(res, await activeTariff(homeId));
  }),
);

// --- Bill estimation -------------------------------------------------------

billingRouter.get(
  '/estimate',
  asyncHandler(async (req, res) => {
    const homeId = await resolveHome(req.query as Record<string, unknown>, req.auth!.userId);
    const rangePreset = (typeof req.query.range === 'string' ? req.query.range : 'this_month') as RangePreset;
    const range = resolveRange(rangePreset);
    const devices = await accessibleDevices(req.auth!.userId, homeId);

    const now = new Date();
    const result = await estimateBill(homeId, devices.map((d) => d.id), range.from, now, now);
    return ok(res, {
      ...result.breakdown,
      projection: result.projection,
      tariff: result.tariff ? { id: result.tariff.id, name: result.tariff.name, provider: result.tariff.provider } : null,
      periodStart: range.from.toISOString(),
      periodEnd: now.toISOString(),
      disclaimer: 'Estimate only. Your electricity provider\'s bill remains authoritative.',
    });
  }),
);

billingRouter.get(
  '/bills',
  asyncHandler(async (req, res) => {
    const homeId = await resolveHome(req.query as Record<string, unknown>, req.auth!.userId);
    const rows = await db
      .select()
      .from(electricityBills)
      .where(eq(electricityBills.homeId, homeId))
      .orderBy(desc(electricityBills.periodStart))
      .limit(24);
    return ok(res, rows);
  }),
);

billingRouter.post(
  '/bills',
  validate({
    body: z.object({
      homeId: z.string().uuid(),
      periodStart: z.string(),
      periodEnd: z.string(),
      actualCost: z.coerce.number().min(0),
      energyKwh: z.coerce.number().min(0),
      fixedCharge: z.coerce.number().min(0).optional(),
      duty: z.coerce.number().min(0).optional(),
      rebate: z.coerce.number().min(0).optional(),
      distributor: z.string().trim().max(120).optional(),
      notes: z.string().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<{
      homeId: string;
      periodStart: string;
      periodEnd: string;
      actualCost: number;
      energyKwh: number;
      fixedCharge?: number;
      duty?: number;
      rebate?: number;
      distributor?: string;
      notes?: string;
    }>(req);
    await requireHomeAccess(req.auth!.userId, input.homeId);
    const tariff = await activeTariff(input.homeId);
    const estimated = tariff ? calculateCost(input.energyKwh, tariff.input) : null;

    const billId = newId();
    await db.insert(electricityBills).values({
      id: billId,
      homeId: input.homeId,
      tariffId: tariff?.id ?? null,
      periodStart: new Date(input.periodStart),
      periodEnd: new Date(input.periodEnd),
      energyKwh: input.energyKwh,
      estimatedCost: estimated?.total ?? 0,
      actualCost: input.actualCost,
      fixedCharge: input.fixedCharge ?? tariff?.fixedCharge ?? 0,
      duty: input.duty ?? 0,
      rebate: input.rebate ?? 0,
      distributor: input.distributor ?? tariff?.provider ?? null,
      currency: tariff?.currency ?? 'INR',
      status: 'actual',
      notes: input.notes,
      breakdown: estimated
        ? { energyCost: estimated.energyCost, fixedCharge: estimated.fixedCharge, taxAmount: estimated.taxAmount }
        : undefined,
    });
    return created(res, { id: billId });
  }),
);

// --- Appliances ------------------------------------------------------------

billingRouter.get(
  '/appliances',
  asyncHandler(async (req, res) => {
    const homeId = await resolveHome(req.query as Record<string, unknown>, req.auth!.userId);
    const rows = await db.select().from(appliances).where(eq(appliances.homeId, homeId));
    const tariff = await activeTariff(homeId);
    return ok(
      res,
      rows.map((appliance) => {
        const dailyKwh = (appliance.ratedPowerW * appliance.estimatedHoursPerDay) / 1000;
        const monthlyKwh = dailyKwh * 30;
        return {
          ...appliance,
          estimatedDailyKwh: Number(dailyKwh.toFixed(3)),
          estimatedMonthlyKwh: Number(monthlyKwh.toFixed(2)),
          estimatedMonthlyCost: tariff
            ? calculateCost(monthlyKwh, tariff.input).total
            : null,
          measurementType: 'estimated' as const,
        };
      }),
    );
  }),
);

billingRouter.post(
  '/appliances',
  validate({ body: applianceSchema }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<z.infer<typeof applianceSchema>>(req);
    await requireHomeAccess(req.auth!.userId, input.homeId);
    const applianceId = newId();
    await db.insert(appliances).values({ id: applianceId, ...input });
    const dailyKwh = (input.ratedPowerW * input.estimatedHoursPerDay) / 1000;
    await db.insert(applianceUsage).values({
      id: newId(),
      applianceId,
      periodStart: resolveRange('this_month').from,
      periodEnd: new Date(),
      estimatedKwh: Number(dailyKwh.toFixed(3)),
      allocatedKwh: null,
    });
    return created(res, { id: applianceId });
  }),
);

billingRouter.delete(
  '/appliances/:applianceId',
  asyncHandler(async (req, res) => {
    const [appliance] = await db.select().from(appliances).where(eq(appliances.id, req.params.applianceId as string)).limit(1);
    if (!appliance) throw notFound('Appliance not found', 'APPLIANCE_NOT_FOUND');
    await requireHomeAccess(req.auth!.userId, appliance.homeId);
    await db.update(appliances).set({ deletedAt: new Date() }).where(eq(appliances.id, appliance.id));
    return ok(res, { removed: true });
  }),
);

/** Monthly kWh for the selected month, used by the appliance allocation UI. */
billingRouter.get(
  '/appliance-baseline',
  asyncHandler(async (req, res) => {
    const homeId = await resolveHome(req.query as Record<string, unknown>, req.auth!.userId);
    const devices = await accessibleDevices(req.auth!.userId, homeId);
    const month = resolveRange('this_month');
    const total = await energyTotal(devices.map((d) => d.id), month.from, new Date());
    return ok(res, { monthKwh: total });
  }),
);

async function handleBillAnalysis(req: any, res: any): Promise<void> {
  const billAId = String(req.body?.billAId ?? req.query?.billAId ?? '');
  const billBId = String(req.body?.billBId ?? req.query?.billBId ?? '');
  if (!billAId || !billBId) throw badRequest('billAId and billBId are required', 'MISSING_BILL_IDS');

  const [billA] = await db.select().from(electricityBills).where(eq(electricityBills.id, billAId)).limit(1);
  const [billB] = await db.select().from(electricityBills).where(eq(electricityBills.id, billBId)).limit(1);
  if (!billA || !billB) throw notFound('Bill not found', 'BILL_NOT_FOUND');
  await requireHomeAccess(req.auth!.userId, billA.homeId);
  await requireHomeAccess(req.auth!.userId, billB.homeId);
  if (billA.homeId !== billB.homeId) throw badRequest('Bills must belong to the same household', 'MISMATCHED_HOME');

  const versions = await tariffVersionsForHome(billA.homeId);
  const toBill = (row: typeof billA): BillForAnalysis => ({
    id: row.id,
    householdId: row.homeId,
    billingStart: row.periodStart,
    billingEnd: row.periodEnd,
    units: row.energyKwh,
    amount: row.actualCost ?? 0,
    fixedCharge: row.fixedCharge ?? 0,
    duty: row.duty ?? 0,
    rebate: row.rebate ?? 0,
    distributor: row.distributor,
    tariffVersion: versions.find((version) => version.id === row.tariffId) ?? null,
    tariffVersionId: row.tariffId,
  });

  const analysis = analyzeBillChange(toBill(billA), toBill(billB), versions);
  ok(res, analysis);
}

for (const route of ['/bill-analysis', '/analysis', '/analyze', '/root-cause', '/bills/analyze', '/bills/analysis', '/bills/root-cause', '/bill-change']) {
  billingRouter.get(route, asyncHandler(handleBillAnalysis));
  billingRouter.post(route, asyncHandler(handleBillAnalysis));
}

export { badRequest };
