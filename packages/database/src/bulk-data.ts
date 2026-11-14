import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '@wattnexa/config';
import { aggregateSamples } from '@wattnexa/shared';
import type { TelemetrySample } from '@wattnexa/types';
import { closeDatabase, db } from './client';
import {
  alerts,
  appliances,
  applianceUsage,
  automationRules,
  deviceTelemetry,
  devices,
  energyAggregates,
  homes,
  householdMembers,
  notifications,
  subscriptionPlans,
  subscriptions,
  tariffs,
  tariffSlabs,
  users,
  wattbotConversations,
  wattbotMessages,
} from './schema';
import { eq, sql } from 'drizzle-orm';

const DEMO_PASSWORD = 'demo@wattnexa.com';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const id = () => randomUUID();
const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

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

async function main() {
  const existingUsers = await db.select({ id: users.id }).from(users);
  if (existingUsers.length < 1) {
    console.log('• No base users found — run pnpm db:seed first.');
    return;
  }

  // Idempotency marker: skip only when telemetry and appliances are already large.
  const existingTelemetryCount = Number((await db.select({ c: sql<number>`COUNT(*)` }).from(deviceTelemetry))[0]?.c ?? 0);
  const existingApplianceCount = await db.select({ c: sql<number>`COUNT(*)` }).from(appliances);
  if (existingTelemetryCount >= 10000 && Number(existingApplianceCount[0]?.c ?? 0) >= 100) {
    console.log('• Bulk data already present — skipping.');
    return;
  }

  console.log('› Generating large volume of demo data…');
  const now = new Date();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, env.BCRYPT_ROUNDS);

  // --- More users (up to 25 total) ---
  const targetUsers = 25;
  const needUsers = targetUsers - existingUsers.length;
  const names = ['Priya Nair','Rahul Verma','Sneha Iyer','Arjun Reddy','Meera Joshi','Karan Mehta','Divya Rao','Vikram Singh','Ananya Gupta','Rohan Das','Neha Kapoor','Siddharth Jain','Pooja Sharma','Aditya Kumar','Kavya Menon','Manish Patel','Riya Desai','Tarun Bose','Shruti Agarwal','Nikhil Tiwari'];
  const newUsers = [];
  for (let i = 0; i < needUsers && i < names.length; i++) {
    newUsers.push({ id: id(), email: `demo${existingUsers.length + i + 1}@wattnexa.com`, name: names[i]!, role: 'user' as const, passwordHash, emailVerifiedAt: now, timezone: 'Asia/Kolkata', currency: 'INR' });
  }
  if (newUsers.length) await db.insert(users).values(newUsers);
  const allUsers = await db.select().from(users);
  const regularUsers = allUsers.filter((u) => u.role === 'user');

  // --- More homes (up to 15) ---
  const existingHomes = await db.select({ id: homes.id }).from(homes);
  const targetHomes = 15;
  const needHomes = targetHomes - existingHomes.length;
  const homeTypes = ['home','apartment','office','shop'] as const;
  const cityList = ['Bengaluru','Mumbai','Delhi','Chennai','Hyderabad','Pune','Kolkata','Ahmedabad'];
  const newHomes = [];
  for (let i = 0; i < needHomes; i++) {
    const owner = regularUsers[i % regularUsers.length]!;
    newHomes.push({ id: id(), ownerId: owner.id, name: `Household ${existingHomes.length + i + 1}`, type: homeTypes[i % homeTypes.length]!, city: cityList[i % cityList.length]!, region: 'India', country: 'India', timezone: 'Asia/Kolkata' });
  }
  if (newHomes.length) await db.insert(homes).values(newHomes);
  const allHomes = await db.select().from(homes);

  // household members
  const memberRows = [];
  for (const h of allHomes) {
    // ensure owner member exists
    const exists = await db.select().from(householdMembers).where(sql`${householdMembers.homeId} = ${h.id} AND ${householdMembers.userId} = ${h.ownerId}`).limit(1);
    if (exists.length === 0) {
      memberRows.push({ id: id(), homeId: h.id, userId: h.ownerId, role: 'owner' as const, status: 'active' as const });
    }
  }
  if (memberRows.length) await db.insert(householdMembers).values(memberRows);

  // --- Devices (up to 30) ---
  const existingDevices = await db.select({ id: devices.id }).from(devices);
  const targetDevices = 30;
  const needDevices = targetDevices - existingDevices.length;
  const newDevices = [];
  for (let i = 0; i < needDevices; i++) {
    const home = allHomes[i % allHomes.length]!;
    newDevices.push({ id: id(), homeId: home.id, ownerId: home.ownerId, name: `Meter ${existingDevices.length + i + 1}`, serial: `WNX-ESP32-${String(existingDevices.length + i + 1).padStart(4, '0')}`, model: 'WattNexa CT-1', firmwareVersion: '1.4.2', status: 'online' as const, lastSeenAt: now, lastReadingAt: now, signalStrength: -60 });
  }
  if (newDevices.length) await db.insert(devices).values(newDevices);
  const allDevices = await db.select().from(devices);

  // --- Appliances (up to 150) ---
  const existingApps = await db.select({ id: appliances.id }).from(appliances);
  const targetApps = 150;
  const needApps = targetApps - existingApps.length;
  const appSeed = [
    { name: 'Refrigerator', category: 'refrigerator', ratedPowerW: 180, estimatedHoursPerDay: 24 },
    { name: 'Split AC (1.5 ton)', category: 'air_conditioner', ratedPowerW: 1500, estimatedHoursPerDay: 5 },
    { name: 'Ceiling fan', category: 'fan', ratedPowerW: 75, estimatedHoursPerDay: 8 },
    { name: 'Washing machine', category: 'washing_machine', ratedPowerW: 500, estimatedHoursPerDay: 1 },
    { name: 'Television', category: 'television', ratedPowerW: 100, estimatedHoursPerDay: 4 },
    { name: 'Water heater', category: 'water_heater', ratedPowerW: 2000, estimatedHoursPerDay: 0.5 },
    { name: 'Laptop', category: 'computer', ratedPowerW: 65, estimatedHoursPerDay: 6 },
    { name: 'Microwave', category: 'kitchen_appliance', ratedPowerW: 1200, estimatedHoursPerDay: 0.5 },
    { name: 'LED lights', category: 'other', ratedPowerW: 40, estimatedHoursPerDay: 6 },
    { name: 'Water pump', category: 'water_pump', ratedPowerW: 750, estimatedHoursPerDay: 1 },
  ];
  const newApps = [];
  for (let i = 0; i < needApps; i++) {
    const home = allHomes[i % allHomes.length]!;
    const seed = appSeed[i % appSeed.length]!;
    newApps.push({ id: id(), homeId: home.id, name: `${seed.name} ${Math.floor(i / appSeed.length) + 1}`, category: seed.category, brand: 'Demo', model: 'X1', ratedPowerW: seed.ratedPowerW, estimatedHoursPerDay: seed.estimatedHoursPerDay, isMeasured: false });
  }
  if (newApps.length) await db.insert(appliances).values(newApps);
  const allApps = await db.select().from(appliances);

  // appliance usage
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const usageRows = allApps.map((a) => ({ id: id(), applianceId: a.id, periodStart, periodEnd, estimatedKwh: Number(((a.ratedPowerW * a.estimatedHoursPerDay) / 1000).toFixed(3)), allocatedKwh: null }));
  // insert only missing
  const existingUsage = await db.select({ applianceId: applianceUsage.applianceId }).from(applianceUsage);
  const existingUsageSet = new Set(existingUsage.map((u) => u.applianceId));
  const newUsage = usageRows.filter((u) => !existingUsageSet.has(u.applianceId));
  for (const b of chunk(newUsage, 240)) await db.insert(applianceUsage).values(b);

  // --- Telemetry: 15-min intervals for 30 days for each device (top up) ---
  const existingTelemetry = await db.select({ c: sql<number>`COUNT(*)` }).from(deviceTelemetry);
  const targetTelemetry = 15000;
  if (Number(existingTelemetry[0]?.c ?? 0) < targetTelemetry) {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    start.setUTCMinutes(0, 0, 0);
    const allTelemetryRows: any[] = [];
    for (const dev of allDevices) {
      const rand = mulberry32(dev.serial.charCodeAt(0) + dev.serial.length * 100);
      let cumulativeKwh = 1000 + Math.random() * 500;
      for (let cursor = new Date(start); cursor <= now; cursor = new Date(cursor.getTime() + 15 * 60 * 1000)) {
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
        cumulativeKwh += activePower / (1000 * 4);
        allTelemetryRows.push({
          deviceId: dev.id,
          recordedAt: new Date(cursor),
          voltage,
          current,
          activePower,
          apparentPower,
          powerFactor,
          energyKwh: Number(cumulativeKwh.toFixed(3)),
          temperature,
          frequency: Number((49.95 + (rand() - 0.5) * 0.12).toFixed(2)),
          signalStrength: Math.round(-56 - rand() * 12),
          source: 'simulated' as const,
        });
      }
    }
    // bulk insert in batches
    for (const b of chunk(allTelemetryRows, 500)) await db.insert(deviceTelemetry).values(b);
    console.log(`  → inserted ${allTelemetryRows.length} telemetry rows`);
  }

  // --- Alerts (top up to 100) ---
  const existingAlerts = await db.select({ c: sql<number>`COUNT(*)` }).from(alerts);
  const needAlerts = 100 - Number(existingAlerts[0]?.c ?? 0);
  if (needAlerts > 0) {
    const alertTypes = ['high_power','unusual_consumption','device_offline','device_online','high_temperature','daily_threshold','monthly_threshold','bill_threshold','device_error','account'] as const;
    const sevs = ['info','warning','critical'] as const;
    const alertRows = [];
    for (let i = 0; i < needAlerts; i++) {
      const u = regularUsers[i % regularUsers.length]!;
      const h = allHomes[i % allHomes.length]!;
      const d = allDevices[i % allDevices.length]!;
      alertRows.push({ id: id(), userId: u.id, homeId: h.id, deviceId: d.id, type: alertTypes[i % alertTypes.length]!, severity: sevs[i % sevs.length]!, title: `Alert ${i + 1}`, message: `Simulated alert ${i + 1} for monitoring.`, createdAt: new Date(now.getTime() - (i % 30) * 86400000) });
    }
    for (const b of chunk(alertRows, 240)) await db.insert(alerts).values(b);

    // notifications matching
    const notifRows = alertRows.map((a) => ({ id: id(), userId: a.userId, alertId: a.id, channel: 'in_app' as const, title: a.title, body: a.message, readAt: Math.random() > 0.5 ? a.createdAt : null, createdAt: a.createdAt }));
    for (const b of chunk(notifRows, 240)) await db.insert(notifications).values(b);
  }

  // top up notifications to 200
  const existingNotifs = await db.select({ c: sql<number>`COUNT(*)` }).from(notifications);
  const needNotifs = 200 - Number(existingNotifs[0]?.c ?? 0);
  if (needNotifs > 0) {
    const notifRows = [];
    for (let i = 0; i < needNotifs; i++) {
      const u = regularUsers[i % regularUsers.length]!;
      notifRows.push({ id: id(), userId: u.id, channel: 'in_app' as const, title: `Notification ${i + 1}`, body: `Simulated notification ${i + 1}.`, createdAt: new Date(now.getTime() - (i % 30) * 86400000) });
    }
    for (const b of chunk(notifRows, 240)) await db.insert(notifications).values(b);
  }

  // --- Automation rules (top up to 50) ---
  const existingRules = await db.select({ c: sql<number>`COUNT(*)` }).from(automationRules);
  const needRules = 50 - Number(existingRules[0]?.c ?? 0);
  if (needRules > 0) {
    const triggers = ['power_above','temperature_above','device_offline','daily_summary','monthly_usage_above'] as const;
    const actions = ['notify','email','summary'] as const;
    const ruleRows = [];
    for (let i = 0; i < needRules; i++) {
      const h = allHomes[i % allHomes.length]!;
      const u = regularUsers[i % regularUsers.length]!;
      ruleRows.push({ id: id(), homeId: h.id, userId: u.id, name: `Rule ${i + 1}`, triggerType: triggers[i % triggers.length]!, threshold: 1000 + i * 10, actionType: actions[i % actions.length]!, message: `Automated action ${i + 1}`, isActive: true });
    }
    for (const b of chunk(ruleRows, 240)) await db.insert(automationRules).values(b);
  }

  // --- WattBot conversations (top up to 40) + messages (top up to 200) ---
  const existingConvos = await db.select({ c: sql<number>`COUNT(*)` }).from(wattbotConversations);
  const needConvos = 40 - Number(existingConvos[0]?.c ?? 0);
  const newConvoIds: string[] = [];
  if (needConvos > 0) {
    const convoRows = [];
    for (let i = 0; i < needConvos; i++) {
      const u = regularUsers[i % regularUsers.length]!;
      const cid = id();
      newConvoIds.push(cid);
      convoRows.push({ id: cid, userId: u.id, title: `Conversation ${i + 1}` });
    }
    for (const b of chunk(convoRows, 240)) await db.insert(wattbotConversations).values(b);
  }
  const allConvos = await db.select().from(wattbotConversations);
  const existingMsgs = await db.select({ c: sql<number>`COUNT(*)` }).from(wattbotMessages);
  const needMsgs = 200 - Number(existingMsgs[0]?.c ?? 0);
  if (needMsgs > 0) {
    const msgRows = [];
    for (let i = 0; i < needMsgs; i++) {
      const c = allConvos[i % allConvos.length]!;
      msgRows.push({ id: id(), conversationId: c.id, role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant', content: `Simulated message ${i + 1}`, provider: 'rule_based' as const });
    }
    for (const b of chunk(msgRows, 240)) await db.insert(wattbotMessages).values(b);
  }

  // --- energy aggregates rebuild for new telemetry (hourly for main device only to save time) ---
  // skip heavy aggregate rebuild; existing aggregates remain.

  console.log('✓ Bulk data generation complete');
}

main()
  .catch((error) => { console.error('✗ Bulk data failed:', error); process.exitCode = 1; })
  .finally(async () => { await closeDatabase(); });
