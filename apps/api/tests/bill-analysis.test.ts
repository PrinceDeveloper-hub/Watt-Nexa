import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, electricityBills, homes, tariffs, tariffSlabs, users } from '@wattnexa/database';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { analyzeBillChange } from '@wattnexa/shared';
import type { BillForAnalysis, TariffVersion } from '@wattnexa/shared';

const app = createApp();
let cookie = '';
let homeId = '';
let tariffId = '';
const billIds: string[] = [];

beforeAll(async () => {
  const [user] = await db.select().from(users).where(eq(users.email, 'demo@wattnexa.com')).limit(1);
  const [home] = await db.select().from(homes).where(eq(homes.ownerId, user!.id)).limit(1);
  homeId = home!.id;
  const [tariff] = await db.select().from(tariffs).where(eq(tariffs.homeId, homeId)).limit(1);
  tariffId = tariff!.id;

  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'demo@wattnexa.com', password: 'demo@wattnexa.com' })
    .expect(200);
  const raw = response.headers['set-cookie'] as unknown as string[] | undefined;
  cookie = (raw ?? []).map((value) => value.split(';')[0]).join('; ');

  const idA = randomUUID();
  const idB = randomUUID();
  billIds.push(idA, idB);
  await db.insert(electricityBills).values([
    {
      id: idA,
      homeId,
      tariffId,
      periodStart: new Date('2026-02-01T00:00:00.000Z'),
      periodEnd: new Date('2026-02-28T00:00:00.000Z'),
      energyKwh: 100,
      estimatedCost: 600,
      actualCost: 620,
      fixedCharge: 100,
      duty: 10,
      rebate: 5,
      distributor: 'WBSEDCL',
      status: 'actual',
    },
    {
      id: idB,
      homeId,
      tariffId,
      periodStart: new Date('2026-03-01T00:00:00.000Z'),
      periodEnd: new Date('2026-03-31T00:00:00.000Z'),
      energyKwh: 150,
      estimatedCost: 900,
      actualCost: 980,
      fixedCharge: 120,
      duty: 15,
      rebate: 0,
      distributor: 'WBSEDCL',
      status: 'actual',
    },
  ]);
});

afterAll(async () => {
  for (const id of billIds) {
    await db.delete(electricityBills).where(eq(electricityBills.id, id));
  }
});

it('returns a saved analysis matching the pure module output', async () => {
  const response = await request(app)
    .get(`/api/v1/billing/bill-analysis?billAId=${billIds[0]}&billBId=${billIds[1]}`)
    .set('Cookie', cookie)
    .expect(200);

  const tariffRows = await db.select().from(tariffs).where(eq(tariffs.homeId, homeId));
  const versions: TariffVersion[] = await Promise.all(
    tariffRows.map(async (row) => {
      const slabs = await db.select().from(tariffSlabs).where(eq(tariffSlabs.tariffId, row.id));
      return {
        id: row.id,
        distributor: row.distributor ?? row.provider ?? null,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        slabs: slabs.map((slab) => ({ minKwh: slab.minKwh, maxKwh: slab.maxKwh, ratePerKwh: slab.ratePerKwh })),
        fixedCharge: row.fixedCharge,
        dutyRate: row.dutyRate ?? row.taxPercent,
        sourceReference: row.sourceReference,
      };
    }),
  );

  const [billA] = await db.select().from(electricityBills).where(eq(electricityBills.id, billIds[0]));
  const [billB] = await db.select().from(electricityBills).where(eq(electricityBills.id, billIds[1]));
  const toBill = (row: any): BillForAnalysis => ({
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

  const expected = analyzeBillChange(toBill(billA), toBill(billB), versions);
  expect(response.body.data).toMatchObject({
    totalDifference: expected.totalDifference,
    hasEnoughData: expected.hasEnoughData,
  });
  expect(response.body.data.components).toHaveLength(expected.components.length);
});
