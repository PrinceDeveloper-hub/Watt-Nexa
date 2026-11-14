/**
 * Extracts an explicit date range from a question with deterministic parsing.
 *
 * The model never gets to choose SQL or a time window: the range is parsed here,
 * bounded, and handed to `collectFacts` as a validated half-open UTC window.
 */

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH_PATTERN =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const DAY_SUFFIX = '(?:st|nd|rd|th)?';

/** Longest window we will aggregate in one question. */
export const MAX_RANGE_DAYS = 366;

export type RangeParse =
  | { status: 'none' }
  | { status: 'ok'; from: Date; to: Date; label: string }
  | { status: 'invalid'; label: string }
  | { status: 'too_long'; label: string };

interface Token {
  index: number;
  year: number | null;
  month: number;
  /** null = the whole month was named. */
  day: number | null;
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

function makeUtcDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

/**
 * A range without a year means the most recent occurrence, not next year:
 * "march 5" in January is last March, not a future date.
 */
function inferYear(explicit: number | null, month: number, day: number, now: Date): number {
  if (explicit) return explicit;
  const candidate = Date.UTC(now.getUTCFullYear(), month - 1, day);
  return candidate > now.getTime() + 2 * 86_400_000 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
}

function tokenise(text: string): Token[] {
  const tokenPattern = new RegExp(
    [
      '(?<iso>\\d{4}-\\d{1,2}-\\d{1,2})',
      '(?<dmy>\\d{1,2}[/.]\\d{1,2}[/.]\\d{4})',
      // (?!\\d) keeps "March 2026" from being read as day 20 of March.
      `(?<dayMonth>\\d{1,2}${DAY_SUFFIX}(?!\\d)\\s+(?:of\\s+)?${MONTH_PATTERN}(?:,?\\s+\\d{4})?)`,
      `(?<monthDay>${MONTH_PATTERN}\\s+\\d{1,2}${DAY_SUFFIX}(?!\\d)(?:,?\\s+\\d{4})?)`,
      `(?<monthYear>${MONTH_PATTERN}\\s+\\d{4})`,
    ].join('|'),
    'gi',
  );

  const tokens: Token[] = [];
  for (const match of text.matchAll(tokenPattern)) {
    const groups = match.groups ?? {};
    const index = match.index ?? 0;
    const raw = match[0];

    if (groups.iso) {
      const [year, month, day] = raw.split('-').map(Number) as [number, number, number];
      tokens.push({ index, year, month, day });
      continue;
    }

    if (groups.dmy) {
      const [day, month, year] = raw.split(/[/.]/).map(Number) as [number, number, number];
      tokens.push({ index, year, month, day });
      continue;
    }

    const monthMatch = raw.match(new RegExp(MONTH_PATTERN, 'i'));
    const month = monthMatch ? MONTHS[monthMatch[0].toLowerCase()] : undefined;
    if (!month) continue;

    const yearMatch = raw.match(/\b(\d{4})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : null;
    const dayMatch = raw.match(new RegExp(`\\b(\\d{1,2})${DAY_SUFFIX}\\b`, 'i'));
    tokens.push({ index, year, month, day: dayMatch ? Number(dayMatch[1]) : null });
  }

  return tokens.sort((a, b) => a.index - b.index);
}

function tokenBounds(token: Token, now: Date): { start: Date; endExclusive: Date } | null {
  if (token.day === null) {
    const year = token.year ?? now.getUTCFullYear();
    const start = makeUtcDate(year, token.month, 1);
    const endExclusive = new Date(Date.UTC(year, token.month, 1));
    return start ? { start, endExclusive } : null;
  }

  const year = inferYear(token.year, token.month, token.day, now);
  const start = makeUtcDate(year, token.month, token.day);
  if (!start) return null;
  return { start, endExclusive: new Date(start.getTime() + 86_400_000) };
}

export function parseDateRange(question: string, now: Date = new Date()): RangeParse {
  const text = question.replace(/\s+/g, ' ').trim();

  // "1-7 march" / "march 1-7" name a span inside one month.
  const shortSpan =
    new RegExp(`\\b(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\s+(?:of\\s+)?(${MONTH_PATTERN})(?:,?\\s+(\\d{4}))?`, 'i').exec(
      text,
    ) ??
    new RegExp(`(${MONTH_PATTERN})\\s+(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})(?:,?\\s+(\\d{4}))?`, 'i').exec(text);

  if (shortSpan) {
    const dayFirst = /^\d/.test(shortSpan[1]!);
    const firstDay = Number(dayFirst ? shortSpan[1] : shortSpan[2]);
    const secondDay = Number(dayFirst ? shortSpan[2] : shortSpan[3]);
    const monthName = (dayFirst ? shortSpan[3] : shortSpan[1])!.toLowerCase();
    const yearRaw = shortSpan[4];
    const month = MONTHS[monthName];
    if (!month) return { status: 'invalid', label: shortSpan[0] };

    const year = inferYear(yearRaw ? Number(yearRaw) : null, month, firstDay, now);
    const start = makeUtcDate(year, month, firstDay);
    const end = makeUtcDate(year, month, secondDay);
    if (!start || !end || end < start) return { status: 'invalid', label: shortSpan[0] };

    const to = new Date(end.getTime() + 86_400_000);
    const label = `${iso(start)} to ${iso(new Date(to.getTime() - 86_400_000))}`;
    return spanCheck(start, to, label);
  }

  const tokens = tokenise(text);
  if (tokens.length === 0) return { status: 'none' };

  if (tokens.length === 1) {
    const bounds = tokenBounds(tokens[0]!, now);
    if (!bounds) return { status: 'invalid', label: tokens[0]!.day ? '' : 'month' };
    const lastDay = new Date(bounds.endExclusive.getTime() - 86_400_000);
    return spanCheck(bounds.start, bounds.endExclusive, iso(bounds.start) === iso(lastDay) ? iso(bounds.start) : `${iso(bounds.start)} to ${iso(lastDay)}`);
  }

  const first = tokens[0]!;
  const second = tokens[1]!;
  let startBounds = tokenBounds(first, now);
  let endBounds = tokenBounds(second, now);
  if (!startBounds || !endBounds) return { status: 'invalid', label: '' };

  // "dec 20 to jan 5": the second date belongs to the following year.
  if (!second.year && endBounds.start < startBounds.start) {
    const shifted: Token = { ...second, year: (first.year ?? now.getUTCFullYear()) + 1 };
    const retry = tokenBounds(shifted, now);
    if (retry) endBounds = retry;
  }

  const label = `${iso(startBounds.start)} to ${iso(new Date(endBounds.endExclusive.getTime() - 86_400_000))}`;
  return spanCheck(startBounds.start, endBounds.endExclusive, label);
}

function spanCheck(from: Date, to: Date, label: string): RangeParse {
  if (!(from < to)) return { status: 'invalid', label };
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
    return { status: 'too_long', label };
  }
  return { status: 'ok', from, to, label };
}
