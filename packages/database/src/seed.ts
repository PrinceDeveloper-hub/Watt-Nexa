import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '@wattnexa/config';
import { aggregateSamples } from '@wattnexa/shared';
import type { TelemetrySample } from '@wattnexa/types';
import { closeDatabase, db } from './client';
import {
  alerts,
  announcements,
  applianceUsage,
  appliances,
  blogPosts,
  deviceCredentials,
  devicePairings,
  deviceTelemetry,
  devices,
  electricityBills,
  energyAggregates,
  faqs,
  homes,
  householdMembers,
  invoices,
  notificationPreferences,
  notifications,
  payments,
  subscriptionPlans,
  subscriptions,
  tariffSlabs,
  tariffs,
  users,
} from './schema';

const DEMO_PASSWORD = 'WattNexa@123';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const id = () => randomUUID();

/** Deterministic PRNG so seeded charts look the same on every machine. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plausible Indian household load curve. Peaks in the morning and evening;
 * the air conditioner runs through the afternoon on hot days.
 */
function loadWatts(localHour: number, isWeekend: boolean, rand: () => number): number {
  let watts = 95;
  if (localHour >= 0 && localHour < 5) watts += 25;
  if (localHour >= 6 && localHour < 9) watts += 420;
  if (localHour >= 9 && localHour < 13) watts += 160;
  if (localHour >= 13 && localHour < 17) watts += 780;
  if (localHour >= 17 && localHour < 18) watts += 300;
  if (localHour >= 18 && localHour < 22.5) watts += 1050;
  if (localHour >= 22.5) watts += 240;
  if (isWeekend) watts *= 1.14;
  const noise = 1 + (rand() - 0.5) * 0.24;
  return Math.max(40, watts * noise);
}

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export async function seed(): Promise<void> {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) {
    console.log('• Database already contains users — seed skipped.');
    return;
  }

  console.log('› Seeding subscription plans, demo account and 30 days of readings…');

  // --- Plans ---------------------------------------------------------------
  const planRows = [
    {
      id: id(),
      slug: 'free',
      name: 'Free',
      description: 'Monitor one home with core live metrics.',
      priceMonthly: 0,
      maxHomes: 1,
      maxDevices: 1,
      historyDays: 7,
      wattbotMessagesPerDay: 0,
      features: ['Live power & energy', '7 days of history', 'Basic alerts', 'One household'],
      sortOrder: 1,
    },
    {
      id: id(),
      slug: 'plus',
      name: 'Plus',
      description: 'Deeper history, advanced analytics and WattBot.',
      priceMonthly: 199,
      maxHomes: 2,
      maxDevices: 5,
      historyDays: 180,
      wattbotMessagesPerDay: 20,
      features: [
        '180 days of history',
        'Bill estimation & tariff slabs',
        'Advanced notifications',
        'WattBot (20 messages/day)',
      ],
      sortOrder: 2,
    },
    {
      id: id(),
      slug: 'pro',
      name: 'Pro',
      description: 'Multi-property monitoring with automation.',
      priceMonthly: 499,
      maxHomes: 10,
      maxDevices: 25,
      historyDays: 730,
      wattbotMessagesPerDay: 100,
      features: [
        'Multi-household dashboards',
        'Advanced reports & exports',
        'Automation rules',
        'WattBot (100 messages/day)',
        'Priority support',
      ],
      sortOrder: 3,
    },
  ];
  await db.insert(subscriptionPlans).values(planRows);
  const plusPlan = planRows[1]!;

  // --- Users ---------------------------------------------------------------
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, env.BCRYPT_ROUNDS);
  const now = new Date();
  const makeUser = (email: string, name: string, role: 'user' | 'admin' | 'super_admin' | 'support_agent') => ({
    id: id(),
    email,
    name,
    role,
    passwordHash,
    emailVerifiedAt: now,
    timezone: 'Asia/Kolkata',
    currency: 'INR',
  });

  const demoUser = makeUser('demo@wattnexa.com', 'Aarav Sharma', 'user');
  const adminUser = makeUser('admin@wattnexa.com', 'Platform Admin', 'admin');
  const superUser = makeUser('super@wattnexa.com', 'Super Admin', 'super_admin');
  const supportUser = makeUser('support@wattnexa.com', 'Support Agent', 'support_agent');
  await db.insert(users).values([demoUser, adminUser, superUser, supportUser]);

  // --- Subscription --------------------------------------------------------
  const subscriptionId = id();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  await db.insert(subscriptions).values({
    id: subscriptionId,
    userId: demoUser.id,
    planId: plusPlan.id,
    status: 'active',
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    provider: 'sandbox',
  });

  const invoiceId = id();
  await db.insert(invoices).values({
    id: invoiceId,
    userId: demoUser.id,
    subscriptionId,
    number: `WNX-${now.getUTCFullYear()}-0001`,
    amount: plusPlan.priceMonthly,
    status: 'paid',
    issuedAt: periodStart,
    paidAt: periodStart,
  });
  await db.insert(payments).values({
    id: id(),
    invoiceId,
    provider: 'sandbox',
    providerRef: 'sandbox_seed_payment',
    amount: plusPlan.priceMonthly,
    status: 'simulated',
    method: 'sandbox',
  });

  // --- Home + device -------------------------------------------------------
  const homeId = id();
  await db.insert(homes).values({
    id: homeId,
    ownerId: demoUser.id,
    name: 'Sharma Residence',
    type: 'home',
    address: '4th Block, Jayanagar',
    city: 'Bengaluru',
    region: 'Karnataka',
    country: 'India',
    timezone: 'Asia/Kolkata',
  });
  await db.insert(householdMembers).values({
    id: id(),
    homeId,
    userId: demoUser.id,
    role: 'owner',
    status: 'active',
  });

  const deviceId = id();
  const lastSeen = new Date(now.getTime() - 20_000);
  await db.insert(devices).values({
    id: deviceId,
    homeId,
    ownerId: demoUser.id,
    name: 'Main Meter',
    serial: 'WNX-ESP32-0001',
    model: 'WattNexa CT-1',
    room: 'Utility',
    firmwareVersion: '1.4.2',
    status: 'online',
    lastSeenAt: lastSeen,
    lastReadingAt: lastSeen,
    signalStrength: -58,
  });

  const deviceToken = `wnx_dev_${sha256('seed-device-secret').slice(0, 40)}`;
  await db.insert(deviceCredentials).values({
    id: id(),
    deviceId,
    tokenHash: sha256(deviceToken),
    label: 'ESP32 primary',
  });

  // An unclaimed pairing code so the pairing flow can be exercised.
  await db.insert(devicePairings).values({
    id: id(),
    code: 'WNX-PAIR-4F2A',
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  });

  // --- Tariff --------------------------------------------------------------
  const tariffId = id();
  await db.insert(tariffs).values({
    id: tariffId,
    homeId,
    name: 'BESCOM Domestic',
    provider: 'BESCOM',
    region: 'Karnataka',
    currency: 'INR',
    fixedCharge: 120,
    taxPercent: 0,
    isActive: true,
  });
  await db.insert(tariffSlabs).values([
    { id: id(), tariffId, minKwh: 0, maxKwh: 50, ratePerKwh: 4.15, sortOrder: 1 },
    { id: id(), tariffId, minKwh: 50, maxKwh: 100, ratePerKwh: 5.75, sortOrder: 2 },
    { id: id(), tariffId, minKwh: 100, maxKwh: 200, ratePerKwh: 7.2, sortOrder: 3 },
    { id: id(), tariffId, minKwh: 200, maxKwh: null, ratePerKwh: 8.1, sortOrder: 4 },
  ]);

  // --- Appliances (manual estimates, explicitly not measured) --------------
  const applianceSeed = [
    { name: 'Refrigerator', category: 'Kitchen', ratedPowerW: 180, estimatedHoursPerDay: 24 },
    { name: 'Split AC (1.5 ton)', category: 'Cooling', ratedPowerW: 1500, estimatedHoursPerDay: 5 },
    { name: 'Ceiling fans', category: 'Cooling', ratedPowerW: 75, estimatedHoursPerDay: 8 },
    { name: 'Washing machine', category: 'Laundry', ratedPowerW: 500, estimatedHoursPerDay: 1 },
    { name: 'Television', category: 'Entertainment', ratedPowerW: 100, estimatedHoursPerDay: 4 },
    { name: 'Water heater', category: 'Kitchen', ratedPowerW: 2000, estimatedHoursPerDay: 0.5 },
  ];
  const applianceRows = applianceSeed.map((item) => ({ id: id(), homeId, ...item, isMeasured: false }));
  await db.insert(appliances).values(applianceRows);

  const usageRows = applianceRows.map((appliance) => {
    const estimatedKwh = (appliance.ratedPowerW * appliance.estimatedHoursPerDay) / 1000;
    return {
      id: id(),
      applianceId: appliance.id,
      periodStart,
      periodEnd,
      estimatedKwh: Number(estimatedKwh.toFixed(3)),
      allocatedKwh: null,
    };
  });
  await db.insert(applianceUsage).values(usageRows);

  // --- 30 days of hourly telemetry ----------------------------------------
  const rand = mulberry32(20260101);
  const samples: TelemetrySample[] = [];
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  start.setUTCMinutes(0, 0, 0);

  let cumulativeKwh = 1420.4;
  for (let cursor = new Date(start); cursor <= now; cursor = new Date(cursor.getTime() + 3_600_000)) {
    const localMs = cursor.getTime() + 5.5 * 3_600_000;
    const local = new Date(localMs);
    const localHour = local.getUTCHours() + local.getUTCMinutes() / 60;
    const isWeekend = local.getUTCDay() === 0 || local.getUTCDay() === 6;

    const activePower = Number(loadWatts(localHour, isWeekend, rand).toFixed(1));
    const powerFactor = Number((0.93 + rand() * 0.05).toFixed(2));
    const voltage = Number((229 + (rand() - 0.5) * 7).toFixed(1));
    const current = Number((activePower / voltage).toFixed(3));
    const apparentPower = Number((activePower / powerFactor).toFixed(1));
    const temperature = Number((29.5 + (activePower / 1800) * 5 + rand() * 0.8).toFixed(1));
    cumulativeKwh += activePower / 1000;

    samples.push({
      deviceId,
      recordedAt: cursor.toISOString(),
      voltage,
      current,
      activePower,
      apparentPower,
      powerFactor,
      energyKwh: Number(cumulativeKwh.toFixed(3)),
      temperature,
      frequency: Number((49.95 + (rand() - 0.5) * 0.12).toFixed(2)),
      signalStrength: Math.round(-56 - rand() * 12),
      source: 'simulated',
    });
  }

  const rows = samples.map((sample) => ({
    deviceId: sample.deviceId,
    recordedAt: new Date(sample.recordedAt),
    voltage: sample.voltage,
    current: sample.current,
    activePower: sample.activePower,
    apparentPower: sample.apparentPower,
    powerFactor: sample.powerFactor,
    energyKwh: sample.energyKwh,
    temperature: sample.temperature,
    frequency: sample.frequency,
    signalStrength: sample.signalStrength,
    source: sample.source,
  }));
  for (const batch of chunk(rows, 240)) {
    await db.insert(deviceTelemetry).values(batch);
  }

  // --- Aggregates derived from the raw readings ---------------------------
  const hourly = aggregateSamples(samples, 'hour', { intervalSeconds: 3600 });
  const dailyMap = new Map<string, { energyKwh: number; peak: number; sum: number; n: number }>();
  for (const point of hourly) {
    const key = point.timestamp.slice(0, 10);
    const entry = dailyMap.get(key) ?? { energyKwh: 0, peak: 0, sum: 0, n: 0 };
    entry.energyKwh += point.energyKwh;
    entry.peak = Math.max(entry.peak, point.peakPowerW);
    entry.sum += point.averagePowerW;
    entry.n += 1;
    dailyMap.set(key, entry);
  }

  const aggregateRows = [
    ...hourly.map((point) => ({
      homeId,
      deviceId,
      bucket: 'hour' as const,
      bucketStart: new Date(point.timestamp),
      energyKwh: point.energyKwh,
      peakPowerW: point.peakPowerW,
      averagePowerW: point.averagePowerW,
      sampleCount: point.samples,
      source: 'simulated' as const,
    })),
    ...[...dailyMap.entries()].map(([day, entry]) => ({
      homeId,
      deviceId,
      bucket: 'day' as const,
      bucketStart: new Date(`${day}T00:00:00.000Z`),
      energyKwh: Number(entry.energyKwh.toFixed(3)),
      peakPowerW: entry.peak,
      averagePowerW: Number((entry.sum / Math.max(1, entry.n)).toFixed(1)),
      sampleCount: entry.n,
      source: 'simulated' as const,
    })),
  ];
  for (const batch of chunk(aggregateRows, 240)) {
    await db.insert(energyAggregates).values(batch);
  }

  const todayKwh = aggregateRows
    .filter((row) => row.bucket === 'day')
    .slice(-30)
    .reduce((sum, row) => sum + row.energyKwh, 0);
  console.log(`  → ${rows.length} telemetry rows, ${aggregateRows.length} aggregates (≈${todayKwh.toFixed(0)} kWh total)`);

  // --- Alerts & notifications ---------------------------------------------
  const alertSeed = [
    {
      type: 'high_power' as const,
      severity: 'warning' as const,
      title: 'Evening peak above 1.8 kW',
      message:
        'Between 19:00 and 20:00 your home drew more than 1.8 kW. The air conditioner and water heater overlapped.',
      createdAt: new Date(now.getTime() - 14 * 3_600_000),
    },
    {
      type: 'device_offline' as const,
      severity: 'info' as const,
      title: 'Main Meter briefly offline',
      message: 'The device stopped reporting for 6 minutes and reconnected automatically.',
      createdAt: new Date(now.getTime() - 3 * 24 * 3_600_000),
    },
    {
      type: 'monthly_threshold' as const,
      severity: 'warning' as const,
      title: 'Monthly usage crossed 250 kWh',
      message: 'You have used more energy this month than the same point last month.',
      createdAt: new Date(now.getTime() - 2 * 24 * 3_600_000),
    },
    {
      type: 'account' as const,
      severity: 'info' as const,
      title: 'Welcome to WattNexa',
      message: 'Your demo household is ready. All readings are clearly marked as simulated.',
      createdAt: new Date(now.getTime() - 30 * 24 * 3_600_000),
    },
  ];

  const alertRows = alertSeed.map((alert) => ({
    id: id(),
    userId: demoUser.id,
    homeId,
    deviceId: alert.type === 'account' ? null : deviceId,
    ...alert,
  }));
  await db.insert(alerts).values(alertRows);

  await db.insert(notifications).values(
    alertRows.map((alert) => ({
      id: id(),
      userId: demoUser.id,
      alertId: alert.id,
      channel: 'in_app' as const,
      title: alert.title,
      body: alert.message,
      readAt: alert.type === 'account' ? alert.createdAt : null,
      createdAt: alert.createdAt,
    })),
  );

  await db.insert(notificationPreferences).values({
    userId: demoUser.id,
    emailEnabled: true,
    pushEnabled: false,
    powerThresholdW: 2000,
    temperatureThresholdC: 45,
    dailyKwhThreshold: 12,
    monthlyKwhThreshold: 300,
    billThreshold: 2500,
  });

  // --- A bill record -------------------------------------------------------
  const billStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const billEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  await db.insert(electricityBills).values({
    id: id(),
    homeId,
    tariffId,
    periodStart: billStart,
    periodEnd: billEnd,
    energyKwh: 318.6,
    estimatedCost: 2418,
    actualCost: 2350,
    status: 'actual',
    notes: 'Entered manually from the provider bill for comparison.',
  });

  // --- Public content ------------------------------------------------------
  await db.insert(faqs).values([
    {
      id: id(),
      question: 'Do I need to replace my existing electricity meter?',
      answer:
        'No. WattNexa uses a non-invasive clamp-on CT sensor around your incoming cable, so nothing is rewired and no meter is replaced.',
      category: 'hardware',
      sortOrder: 1,
    },
    {
      id: id(),
      question: 'Can WattNexa tell me which appliance is running?',
      answer:
        'A single whole-house sensor measures total consumption. WattNexa can estimate appliance shares from the ratings and hours you enter, but it does not claim to identify individual appliances automatically.',
      category: 'product',
      sortOrder: 2,
    },
    {
      id: id(),
      question: 'Is the bill estimate the same as my actual bill?',
      answer:
        'It is an estimate computed from your configured tariff slabs and taxes. Your provider\'s bill remains authoritative; WattNexa lets you record the real amount and compare.',
      category: 'billing',
      sortOrder: 3,
    },
    {
      id: id(),
      question: 'What happens when my internet goes down?',
      answer:
        'The device buffers readings in local memory and uploads them when connectivity returns, so you see a gap in timestamps rather than invented data.',
      category: 'hardware',
      sortOrder: 4,
    },
    {
      id: id(),
      question: 'Does WattBot have access to other households?',
      answer:
        'No. WattBot answers only from your own authorised readings and household configuration.',
      category: 'wattbot',
      sortOrder: 5,
    },
  ]);

  await db.insert(blogPosts).values([
    {
      id: id(),
      slug: 'understanding-your-electricity-bill',
      title: 'Understanding your electricity bill, slab by slab',
      excerpt:
        'Most households read only the total. Here is how progressive slabs, fixed charges and taxes combine into the number you pay.',
      content:
        'Electricity tariffs are usually progressive: the first units cost less than the last ones. That means your average rate rises as you consume more.\n\nFixed charges apply regardless of usage, and taxes are typically levied on the sum of energy and fixed charges. WattNexa models all three so you can see which slab you land in and what the next 50 units would cost.',
      status: 'published',
      authorId: adminUser.id,
      publishedAt: new Date(now.getTime() - 12 * 24 * 3_600_000),
    },
    {
      id: id(),
      slug: 'what-a-ct-sensor-can-and-cannot-measure',
      title: 'What a CT sensor can and cannot measure',
      excerpt:
        'Clamp-on current sensing is cheap and safe, but it does not measure voltage on its own. Knowing the difference keeps your dashboard honest.',
      content:
        'A current transformer measures current. Real power needs both current and voltage, plus the phase relationship between them.\n\nWattNexa therefore reports voltage and power factor as unavailable unless the hardware actually senses them, rather than filling the gap with plausible-looking numbers.',
      status: 'published',
      authorId: adminUser.id,
      publishedAt: new Date(now.getTime() - 5 * 24 * 3_600_000),
    },
    {
      id: id(),
      slug: 'cutting-standby-load',
      title: 'The quiet cost of standby load',
      excerpt:
        'Set-top boxes, chargers and televisions idle at a few watts each. Across a year that adds up to real money.',
      content:
        'Standby draw is small per device but constant. Measure your base load at 3am: whatever remains is your household floor.\n\nReducing it usually means switched power strips rather than behaviour change.',
      status: 'published',
      authorId: adminUser.id,
      publishedAt: new Date(now.getTime() - 2 * 24 * 3_600_000),
    },
  ]);

  await db.insert(announcements).values({
    id: id(),
    title: 'WattNexa is in early access',
    body: 'Device firmware 1.4.2 is rolling out. Firmware updates are applied over the air and can be paused from the devices page.',
    level: 'info',
  });

  console.log('✓ Seed complete');
  console.log('');
  console.log('  Demo account   demo@wattnexa.com / ' + DEMO_PASSWORD);
  console.log('  Admin account  admin@wattnexa.com / ' + DEMO_PASSWORD);
  console.log('  Support        support@wattnexa.com / ' + DEMO_PASSWORD);
  console.log('  Pairing code   WNX-PAIR-4F2A');
  console.log(`  Device token   ${deviceToken}  (store it; shown once)`);
  console.log('');
}

const isDirectRun = process.argv[1]?.endsWith('seed.ts') ?? false;
if (isDirectRun) {
  seed()
    .catch((error) => {
      console.error('✗ Seed failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDatabase();
    });
}
