export function formatCurrency(value: number, currency = 'INR', locale = 'en-IN'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatNumber(value: number, digits = 1, locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatKwh(value: number): string {
  if (value < 0.01 && value > 0) return '<0.01 kWh';
  return `${formatNumber(value, value < 10 ? 2 : 1)} kWh`;
}

export function formatPower(watts: number): string {
  if (Math.abs(watts) >= 1000) return `${formatNumber(watts / 1000, 2)} kW`;
  return `${formatNumber(watts, 0)} W`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${formatNumber(value, digits)}%`;
}

/** Human label for a range preset, used in chart captions. */
export function rangeLabel(preset: string): string {
  const labels: Record<string, string> = {
    today: 'Today',
    yesterday: 'Yesterday',
    last_7_days: 'Last 7 days',
    last_30_days: 'Last 30 days',
    last_90_days: 'Last 90 days',
    this_month: 'This month',
    previous_month: 'Previous month',
    custom: 'Custom range',
  };
  return labels[preset] ?? 'Selected range';
}
