import { env } from '../config';
import { logger } from '../lib/logger';
import { formatCurrency } from '@wattnexa/shared';

export interface WattbotContext {
  userName: string;
  todayKwh: number;
  monthKwh: number;
  previousMonthKwh: number;
  peakPowerW: number;
  monthToDateCost: number;
  projectedMonthlyCost: number;
  currency: string;
  tariffName: string | null;
  deviceName: string | null;
  deviceStatus: string | null;
  topInsight: string | null;
  simulated: boolean;
}

export interface WattbotReply {
  content: string;
  provider: 'rule_based' | 'openai' | 'anthropic';
}

const fmt = (value: number) => value.toFixed(1);

/**
 * Deterministic fallback. It only cites figures supplied in the context, so it
 * cannot invent readings or promise savings.
 */
export function ruleBasedAnswer(question: string, ctx: WattbotContext): string {
  const q = question.toLowerCase();
  const currency = ctx.currency;

  if (/(bill|cost|expensive|charge)/.test(q)) {
    const change =
      ctx.previousMonthKwh > 0
        ? ((ctx.monthKwh - ctx.previousMonthKwh) / ctx.previousMonthKwh) * 100
        : null;
    return [
      `This month you have used **${fmt(ctx.monthKwh)} kWh**, costing an estimated **${formatCurrency(ctx.monthToDateCost, currency)}** on your ${ctx.tariffName ?? 'configured'} tariff.`,
      `At the current rate the month is projected to reach about **${formatCurrency(ctx.projectedMonthlyCost, currency)}**.`,
      change == null
        ? 'There is not enough history from last month to compare yet.'
        : `That is ${change >= 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(0)}% on the same point last month (${fmt(ctx.previousMonthKwh)} kWh).`,
      '',
      '_This is an estimate from your tariff settings, not your provider\'s bill._',
    ].join('\n');
  }

  if (/(today|now|current|right now)/.test(q)) {
    return `So far today you have used **${fmt(ctx.todayKwh)} kWh**. The highest instantaneous draw recorded in the selected period was **${(ctx.peakPowerW / 1000).toFixed(2)} kW**.`;
  }

  if (/(peak|highest|maximum)/.test(q)) {
    return `Peak draw in the selected period was **${(ctx.peakPowerW / 1000).toFixed(2)} kW**. Running high-power appliances one at a time — rather than overlapping — is the usual way to lower this.`;
  }

  if (/(compare|last month|previous)/.test(q)) {
    if (ctx.previousMonthKwh <= 0) {
      return 'I do not have last month\'s readings for this household yet, so a comparison would not be meaningful.';
    }
    const change = ((ctx.monthKwh - ctx.previousMonthKwh) / ctx.previousMonthKwh) * 100;
    return `This month: **${fmt(ctx.monthKwh)} kWh**. Same point last month: **${fmt(ctx.previousMonthKwh)} kWh** — a ${change >= 0 ? 'rise' : 'fall'} of ${Math.abs(change).toFixed(0)}%.`;
  }

  if (/(device|sensor|offline|connect|not working)/.test(q)) {
    if (!ctx.deviceName) return 'No device is registered on this household yet. Add one from the Devices page.';
    return `Your device **${ctx.deviceName}** is currently **${ctx.deviceStatus ?? 'unknown'}**. If it shows offline, check its power supply and Wi-Fi; buffered readings upload once it reconnects.`;
  }

  if (/(reduce|save|lower|cut|advice|tip)/.test(q)) {
    const tips = [
      'Shift heavy loads (water heater, washing machine) away from the evening peak.',
      'Your base load is the floor you pay for continuously — switched power strips help.',
      'Compare your bill estimate with the real bill once it arrives; a gap usually means a tariff slab is misconfigured.',
    ];
    return ['Here is what your data supports right now:', '', ...tips.map((t) => `- ${t}`), '', ctx.topInsight ? `Current observation: ${ctx.topInsight}` : ''].join('\n');
  }

  if (/(unusual|high|why)/.test(q)) {
    return ctx.topInsight
      ? `${ctx.topInsight}\n\nThat observation is derived from your own readings for the selected period.`
      : 'I could not find an unusual pattern in the selected period. Usage looks consistent with your recent history.';
  }

  return [
    `I can answer from your own WattNexa data. Right now: **${fmt(ctx.todayKwh)} kWh** today and **${fmt(ctx.monthKwh)} kWh** this month.`,
    '',
    'Try asking:',
    '- Why is my electricity bill increasing?',
    '- How much did I use today?',
    '- What was my peak consumption?',
    '- Compare this month with last month.',
  ].join('\n');
}

interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const systemPrompt = (ctx: WattbotContext) => `You are WattBot, the assistant inside WattNexa, an electricity monitoring product.
Answer only from the supplied household data. Never invent readings, never claim savings are guaranteed.
If the data does not answer the question, say so plainly and suggest what the user could check.
Household context (all figures are estimates from measured/simulated readings):
today_kwh=${ctx.todayKwh}; month_kwh=${ctx.monthKwh}; previous_month_kwh=${ctx.previousMonthKwh};
month_to_date_cost=${ctx.monthToDateCost} ${ctx.currency}; projected_monthly_cost=${ctx.projectedMonthlyCost} ${ctx.currency};
peak_power_w=${ctx.peakPowerW}; tariff=${ctx.tariffName ?? 'not configured'}; device=${ctx.deviceName ?? 'none'} (${ctx.deviceStatus ?? 'unknown'});
data_source=${ctx.simulated ? 'simulated demo readings' : 'hardware readings'}.`;

async function callOpenAi(messages: LlmMessage[]): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: env.OPENAI_MODEL, messages, temperature: 0.3, max_tokens: 500 }),
  });
  if (!response.ok) throw new Error(`OpenAI responded ${response.status}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty OpenAI response');
  return content;
}

async function callAnthropic(messages: LlmMessage[]): Promise<string> {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const rest = messages.filter((m) => m.role !== 'system');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL, system, messages: rest, max_tokens: 500 }),
  });
  if (!response.ok) throw new Error(`Anthropic responded ${response.status}`);
  const data = (await response.json()) as { content?: Array<{ text?: string }> };
  const text = data.content?.map((part) => part.text ?? '').join('');
  if (!text) throw new Error('Empty Anthropic response');
  return text;
}

/** Provider abstraction: swap the model without touching the product code. */
export async function askWattbot(
  question: string,
  ctx: WattbotContext,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<WattbotReply> {
  const provider = env.WATTBOT_PROVIDER;
  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt(ctx) },
    ...history.slice(-8),
    { role: 'user', content: question },
  ];

  try {
    if (provider === 'openai' && env.OPENAI_API_KEY) {
      return { content: await callOpenAi(messages), provider: 'openai' };
    }
    if (provider === 'anthropic' && env.ANTHROPIC_API_KEY) {
      return { content: await callAnthropic(messages), provider: 'anthropic' };
    }
  } catch (error) {
    logger.warn({ err: error }, 'WattBot provider failed, using rule-based fallback');
  }

  return { content: ruleBasedAnswer(question, ctx), provider: 'rule_based' };
}
