import { formatCurrency } from '@wattnexa/shared';
import type { WattbotFacts } from './tools';

const kwh = (value: number) => `${value.toFixed(1)} kWh`;
const money = (value: number, currency: string) => formatCurrency(value, currency);
const pct = (from: number, to: number) => (from > 0 ? ((to - from) / from) * 100 : null);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : 'unknown');
const NO_DATA = 'I have no stored readings for this household yet, so I cannot answer that without guessing.';

function provenanceNote(facts: WattbotFacts): string {
  if (facts.dataSource === 'simulated') {
    return '_These figures come from simulated demo readings, not a physical meter._';
  }
  if (facts.dataSource === 'mixed') {
    return '_Some of these reads are simulated demo data; hardware-sourced rows are marked separately in the dashboard._';
  }
  return '_Figures are computed from your stored device readings._';
}

/**
 * Deterministic answer used when no AI provider is configured, or when the
 * provider times out / rate-limits. It only restates collected facts.
 */
export function ruleBasedAnswer(question: string, facts: WattbotFacts): string {
  const q = question.toLowerCase();
  const { usage: u, bill } = facts;
  const currency = bill?.currency ?? 'INR';

  if (facts.devices.length === 0) {
    return [
      'No device is paired with this household yet, so I have no readings to work from.',
      '',
      'To get started:',
      '- Open **Devices → Add device** and complete pairing.',
      '- Enter the device token on the ESP32 and power it on.',
      '- Once the first reading arrives the device shows as online and I can answer questions about real usage.',
    ].join('\n');
  }

  // An explicitly requested window wins: the user is not asking about today.
  if (facts.custom) {
    if (!facts.custom.ok) {
      return facts.custom.reason === 'too_long'
        ? 'I can compare at most 366 days in one answer. Try a shorter window, for example **between 2026-10-01 and 2026-10-31**.'
        : 'I could not read those dates. Give me an explicit window such as **between 2026-03-01 and 2026-03-07**.';
    }

    const c = facts.custom;
    if (c.samples === 0) {
      return [
        `No readings are stored for **${c.label}**.`,
        '',
        'I will not report that as 0 kWh — the meter has no samples in that window. If you expected data there, check the device connection history.',
      ].join('\n');
    }

    const change = c.previousKwh == null ? null : pct(c.previousKwh, c.energyKwh);
    const perDay = c.energyKwh / c.days;
    const shown = c.daily.slice(-14);
    return [
      `Between **${c.label}** you used **${kwh(c.energyKwh)}**, from ${c.samples} stored readings over ${c.days} day${c.days === 1 ? '' : 's'}.`,
      `That averages **${kwh(perDay)} per day**; peak draw was **${(c.peakPowerW / 1000).toFixed(2)} kW**.`,
      change == null
        ? 'There is no stored data for the equally long window before it, so I cannot compare.'
        : `The preceding ${c.days}-day window used **${kwh(c.previousKwh!)}** — ${change >= 0 ? 'up' : 'down'} **${Math.abs(change).toFixed(0)}%**.`,
      '',
      `${c.bucket === 'month' ? 'Monthly' : 'Daily'} totals (last ${shown.length}):`,
      ...shown.map((point) => `- ${day(point.date)}: **${kwh(point.energyKwh)}**`),
      '',
      provenanceNote(facts),
    ].join('\n');
  }

  if (u.samples === 0) {
    return [
      NO_DATA,
      '',
      'The device is paired but has not reported a reading yet. I will not estimate consumption from nothing — check the device status on the Devices page.',
    ].join('\n');
  }

  if (/(bill|cost|expensive|charge|pay)/.test(q)) {
    if (!bill) {
      return [
        'I cannot estimate a bill because no electricity tariff is configured for this household.',
        '',
        'Add your provider, slabs and fixed charges under **Billing → Tariff**, and I will calculate from those exact rates. I will not assume a rate, because tariffs differ by state and provider.',
      ].join('\n');
    }
    const change = pct(u.previousMonthToDateKwh, u.monthKwh);
    return [
      `Month to date you have used **${kwh(bill.monthToDateKwh)}**, which costs an estimated **${money(bill.total, currency)}** on your *${bill.tariffName}* tariff.`,
      '',
      'Calculation basis:',
      `- Energy charges: ${money(bill.energyCost, currency)} from ${bill.slabLines.length} slab${bill.slabLines.length === 1 ? '' : 's'}`,
      `- Fixed charge: ${money(bill.fixedCharge, currency)}`,
      `- Tax: ${bill.taxPercent}% = ${money(bill.taxAmount, currency)}`,
      '',
      `At the current pace the month projects to **${kwh(bill.projectedKwh)}** and about **${money(bill.projectedTotal, currency)}**.`,
      change == null
        ? 'There is no comparable point in the previous month yet.'
        : `That is ${change >= 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(0)}% on the same point last month (${kwh(u.previousMonthToDateKwh)}).`,
      '',
      '_This is an estimate from your own tariff settings — not your provider\'s bill._',
    ].join('\n');
  }

  if (/(today|right now|so far)/.test(q)) {
    const delta = pct(u.yesterdayKwh, u.todayKwh);
    return [
      `Today you have used **${kwh(u.todayKwh)}**. Yesterday's total was **${kwh(u.yesterdayKwh)}**.`,
      delta == null
        ? ''
        : `That is ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(0)}% versus the same stage yesterday.`,
      '',
      provenanceNote(facts),
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (/(compare|last week|this week|7 day|seven day)/.test(q)) {
    if (u.previous7Kwh <= 0) {
      return [
        `This week you have used **${kwh(u.last7Kwh)}**. I do not have a full previous seven-day window stored yet, so a comparison would be misleading.`,
        u.daily.length
          ? `Daily totals: ${u.daily.map((point) => `${day(point.date)} ${point.energyKwh.toFixed(1)}`).join(' · ')}`
          : '',
        '',
        provenanceNote(facts),
      ]
        .filter(Boolean)
        .join('\n');
    }
    const change = pct(u.previous7Kwh, u.last7Kwh);
    return [
      `Last 7 days: **${kwh(u.last7Kwh)}**. The 7 days before that: **${kwh(u.previous7Kwh)}**.`,
      `That is a ${change! >= 0 ? 'rise' : 'fall'} of **${Math.abs(change!).toFixed(0)}%**.`,
      '',
      change! >= 0
        ? 'The increase is spread across recent days; the daily breakdown below shows where the extra energy went.'
        : 'The reduction comes from lower average daily consumption rather than a single outlier day.',
      '',
      u.daily.length
        ? `Daily totals: ${u.daily.map((point) => `${day(point.date)} ${point.energyKwh.toFixed(1)}`).join(' · ')}`
        : '',
      '',
      provenanceNote(facts),
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (/(peak|highest|maximum|when.*(most|high))/.test(q)) {
    return [
      `Your highest instantaneous draw in the last 7 days was **${(u.peakPowerW / 1000).toFixed(2)} kW**${u.peakAt ? ` on ${day(u.peakAt)}` : ''}.`,
      u.peakDayKwh > 0
        ? `The heaviest single day was **${day(u.peakDay)}** with **${kwh(u.peakDayKwh)}**.`
        : '',
      '',
      'Peak power is an instantaneous measurement; daily energy is the total consumed. A short spike raises the kW figure without necessarily raising the kWh much.',
      '',
      provenanceNote(facts),
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (/(increase|decrease|why|changed|unusual|higher)/.test(q)) {
    const monthChange = pct(u.previousMonthToDateKwh, u.monthKwh);
    const daily = [...u.daily].sort((a, b) => b.energyKwh - a.energyKwh);
    return [
      monthChange == null
        ? `This month so far: **${kwh(u.monthKwh)}**. There is no comparable previous-month data, so I cannot attribute a change.`
        : `This month so far is **${kwh(u.monthKwh)}** versus **${kwh(u.previousMonthToDateKwh)}** at the same point last month — ${monthChange >= 0 ? 'up' : 'down'} **${Math.abs(monthChange).toFixed(0)}%**.`,
      daily.length
        ? `The largest contributing day is ${day(daily[0]!.date)} at ${kwh(daily[0]!.energyKwh)}.`
        : '',
      '',
      'A single whole-house CT sensor measures the total supply. It can show **when** consumption rose, but it cannot attribute the increase to a specific appliance.',
      '',
      provenanceNote(facts),
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (/(chart|graph|explain|breakdown|daily)/.test(q)) {
    if (u.daily.length === 0) return NO_DATA;
    const average = u.daily.reduce((sum, point) => sum + point.energyKwh, 0) / u.daily.length;
    return [
      'Here is what your last seven days look like:',
      '',
      ...u.daily.map((point) => `- ${day(point.date)}: **${kwh(point.energyKwh)}** (peak ${(point.peakPowerW / 1000).toFixed(2)} kW)`),
      '',
      `Average per day: **${kwh(average)}**.`,
      '',
      provenanceNote(facts),
    ].join('\n');
  }

  if (/(reduce|save|lower|cut|advice|tip|efficien)/.test(q)) {
    const tips: string[] = [];
    if (u.peakPowerW > 3000) {
      tips.push(
        `Your peak reached ${(u.peakPowerW / 1000).toFixed(2)} kW. Running heavy appliances one after another instead of together lowers the peak, and with it any demand-based charges.`,
      );
    }
    const averageDaily = u.daily.length ? u.last7Kwh / u.daily.length : 0;
    if (averageDaily > 0) {
      tips.push(
        `Your average day is ${kwh(averageDaily)}. A base load that stays constant overnight usually means appliances on standby — a switched strip makes that visible.`,
      );
    }
    if (facts.bill && facts.bill.slabs.length > 1) {
      const nextSlab = facts.bill.slabs.find((slab) => slab.from > facts.bill!.monthToDateKwh);
      if (nextSlab) {
        tips.push(
          `You are approaching the ${nextSlab.from} kWh slab boundary, where the rate rises to ${money(nextSlab.ratePerKwh, currency)}/kWh.`,
        );
      }
    }
    if (facts.staleDevices.length) {
      tips.push(
        `These devices are not reporting: ${facts.staleDevices.join(', ')}. Missing readings make every downstream figure less reliable.`,
      );
    }
    if (tips.length === 0) tips.push('Your stored data does not show a clear inefficiency to target yet; a few more days of readings will help.');
    return [
      'Here is what your own data supports:',
      '',
      ...tips.map((tip) => `- ${tip}`),
      '',
      'I will not quote a savings figure: the actual saving depends on your tariff and which loads you change.',
      '',
      provenanceNote(facts),
    ].join('\n');
  }

  if (/(device|online|offline|sensor|connected|status)/.test(q)) {
    return [
      ...facts.devices.map((device) => {
        const sensors = device.sensors.length ? device.sensors.join(', ') : 'no sensors reported yet';
        return `- **${device.name}** — ${device.status.replace('_', ' ')}. Last seen ${device.lastSeenAt ? new Date(device.lastSeenAt).toISOString().slice(0, 16).replace('T', ' ') : 'never'}. Sensors: ${sensors}.`;
      }),
      '',
      facts.staleDevices.length
        ? `Not reporting right now: **${facts.staleDevices.join(', ')}**. Readings buffered on the device upload once it reconnects.`
        : 'All paired devices are reporting.',
      '',
      'I can report connection state and the last reading; I cannot switch appliances unless compatible switching hardware is installed.',
    ].join('\n');
  }

  return [
    `Right now: **${kwh(u.todayKwh)}** today and **${kwh(u.monthKwh)}** this month.`,
    facts.bill ? `Estimated bill so far: **${money(facts.bill.total, currency)}**.` : 'No tariff configured yet, so I cannot estimate a bill.',
    '',
    'You can ask me:',
    '- How much did I use today?',
    '- Why is my bill higher this month?',
    '- What was my peak consumption?',
    '- Compare this week with last week.',
    '- How can I reduce my electricity use?',
  ].join('\n');
}
