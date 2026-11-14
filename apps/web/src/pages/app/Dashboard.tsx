import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowUpRight,
  Bell,
  Cpu,
  Gauge,
  Home,
  Lightbulb,
  Plus,
  Sparkles,
  Thermometer,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CostBreakdown, EnergyPoint, Insight, LiveMetrics } from '@wattnexa/types';
import { formatCurrency, formatKwh, formatPower } from '@wattnexa/shared';
import { EnergyAreaChart, Sparkline } from '@/components/charts';
import { DashboardPageSkeleton } from '@/components/skeletons';
import {
  BreakdownBar,
  InlineError,
  Segmented,
  SimulatedBadge,
  StatusDot,
  TrendPill,
} from '@/components/common';
import { Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/forms';
import { api } from '@/lib/api';
import { useHomes } from '@/lib/hooks';
import { useRealtime } from '@/lib/socket';
import { timeAgo } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { cn } from '@/lib/utils';

interface Overview {
  homeId: string;
  range: { preset: string; from: string; to: string; bucket: 'hour' | 'day' | 'month' };
  live: LiveMetrics[];
  totals: {
    todayKwh: number;
    monthKwh: number;
    previousMonthKwh: number;
    monthToDateCost: number;
    projectedMonthlyKwh: number;
    projectedMonthlyCost: number;
  };
  series: EnergyPoint[];
  bill: { breakdown: CostBreakdown; tariff: { name: string } | null };
  insights: Insight[];
  simulated: boolean;
  deviceCount: number;
  onlineCount: number;
  tariff: { name: string; provider: string | null; currency: string } | null;
}

interface AlertRow {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  createdAt: string;
  acknowledgedAt: string | null;
}

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: '7 days' },
  { value: 'last_30_days', label: '30 days' },
  { value: 'this_month', label: 'Month' },
] as const;

type RangeValue = (typeof RANGES)[number]['value'];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const severityTone: Record<AlertRow['severity'], string> = {
  critical: 'bg-destructive',
  warning: 'bg-warning',
  info: 'bg-chart-3',
};

export function Dashboard() {
  const { home, homeId, homes, select } = useHomes();
  const { user } = useAuth();
  const [range, setRange] = useState<RangeValue>('last_7_days');
  const queryClient = useQueryClient();

  const overview = useQuery({
    queryKey: ['overview', homeId, range],
    queryFn: () => api.get<Overview>(`/energy/overview?homeId=${homeId}&range=${range}`),
    enabled: Boolean(homeId),
    refetchInterval: 30_000,
  });

  const alerts = useQuery({
    queryKey: ['alerts', 'dashboard'],
    queryFn: () => api.get<AlertRow[]>('/alerts?limit=4'),
  });

  const { connected } = useRealtime({
    'telemetry:new': () => void queryClient.invalidateQueries({ queryKey: ['overview'] }),
    'device:status': () => void queryClient.invalidateQueries({ queryKey: ['overview'] }),
  });

  const data = overview.data;
  const primary = data?.live[0];
  const reading = primary?.reading;
  const simulated = data?.simulated ?? false;
  const currency = data?.tariff?.currency ?? 'INR';
  const monthChange =
    data && data.totals.previousMonthKwh > 0
      ? ((data.totals.monthKwh - data.totals.previousMonthKwh) / data.totals.previousMonthKwh) * 100
      : null;
  const peakPowerW =
    data && data.series.some((point) => point.samples > 0)
      ? Math.max(...data.series.map((point) => point.peakPowerW))
      : null;
  const seriesValues = data?.series.map((point) => point.energyKwh) ?? [];
  const bill = data?.bill.breakdown;
  const unreadAlerts = (alerts.data ?? []).filter((alert) => !alert.acknowledgedAt);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">
            {new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
            {home?.city ? ` · ${home.city}` : ''}
          </p>
          <h1 className="display mt-2 text-[28px] font-semibold leading-tight sm:text-[34px]">
            {greeting()}, {user?.name?.split(' ')[0] ?? 'there'}
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {home
              ? `Live consumption and bill intelligence for ${home.name}.`
              : 'Live consumption and bill intelligence for your household.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {homes.length > 1 ? (
            <Select value={homeId ?? ''} onChange={(event) => select(event.target.value)} className="h-9 w-40 text-xs">
              {homes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          ) : home ? (
            <span className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/70 bg-card px-3 text-[11px] font-medium text-muted-foreground">
              <Home className="h-3.5 w-3.5" />
              {home.name}
              {home.city ? <span className="text-muted-foreground/70">· {home.city}</span> : null}
            </span>
          ) : null}
          <Segmented
            ariaLabel="Overview date range"
            options={RANGES}
            value={range}
            onChange={setRange}
          />
          <SimulatedBadge simulated={simulated} />
        </div>
      </header>

      {overview.isError ? (
        <InlineError message="Could not load your dashboard." onRetry={() => void overview.refetch()} />
      ) : null}

      {overview.isLoading ? <DashboardPageSkeleton /> : null}

      {data && data.deviceCount === 0 ? (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <EmptyState
            className="py-16"
            icon={Cpu}
            title="Your command centre is waiting for a meter"
            description="Pair an ESP32 with a clamp-on CT sensor and WattNexa starts turning readings into kWh, rupees and advice within seconds."
            action={
              <Button asChild>
                <Link to="/devices">
                  <Plus />
                  Pair a device
                </Link>
              </Button>
            }
          />
          <div className="space-y-4">
            <div className="panel p-5">
              <p className="eyebrow">How it works</p>
              <ol className="mt-4 space-y-4">
                {[
                  ['Clamp the CT sensor', 'Clip the sensor around the mains live wire.'],
                  ['Pair the ESP32', 'Generate a code in Devices and enter it on the board.'],
                  ['Read your first sample', 'Pairing never fakes a reading — data does the rest.'],
                ].map(([title, copy], index) => (
                  <li key={title} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/[0.06] text-[11px] font-semibold text-primary">
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-xs font-semibold">{title}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{copy}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <Link
              to="/wattbot"
              className="panel group flex items-center gap-3 p-4 transition-colors hover:border-primary/25"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold">Ask WattBot anything</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  Answers come only from your stored readings and tariff.
                </span>
              </span>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      ) : null}

      {data && data.deviceCount > 0 ? (
        <>
          <section className="grid gap-4 xl:grid-cols-3">
            {/* Live instrument panel */}
            <div className="relative overflow-hidden rounded-3xl border border-white/10 mesh-forest p-5 text-secondary-foreground shadow-lift sm:p-6 xl:col-span-2">
              <div className="pointer-events-none absolute inset-0 opacity-[0.18] grid-bg" />
              <div className="relative flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary-foreground/60">
                    Live draw
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-secondary-foreground/70">
                    {primary ? <StatusDot status={primary.status} className="text-secondary-foreground/80" /> : null}
                    <span className="truncate">{primary?.deviceName ?? 'No meter selected'}</span>
                    {primary?.lastSeenAt ? <span>· {timeAgo(primary.lastSeenAt)}</span> : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {simulated ? (
                    <span className="rounded-full border border-accent/30 bg-accent/15 px-2.5 py-1 text-[10px] font-medium text-accent">
                      Simulated feed
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-secondary-foreground/80">
                    <span
                      className={cn(
                        'live-dot',
                        connected ? 'bg-accent text-accent' : 'bg-secondary-foreground/40 text-secondary-foreground/40',
                      )}
                    />
                    {connected ? 'Live stream' : 'Polling updates'}
                  </span>
                </div>
              </div>

              <div className="relative mt-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="metric text-[46px] font-semibold leading-none sm:text-[58px]">
                    {reading?.activePower != null ? formatPower(reading.activePower) : '—'}
                  </p>
                  <p className="mt-2 max-w-sm text-[11px] leading-relaxed text-secondary-foreground/60">
                    {reading
                      ? `Latest sample at ${new Intl.DateTimeFormat('en-IN', { timeStyle: 'short' }).format(new Date(reading.recordedAt))}.`
                      : 'No sample received yet. Devices are only marked online after real traffic.'}
                  </p>
                </div>
                <div className="w-full max-w-[220px] text-accent">
                  <Sparkline values={seriesValues.slice(-36)} height={64} className="text-accent" />
                  <p className="mt-1 text-right text-[10px] text-secondary-foreground/50">
                    {data.series.length} buckets · {data.range.bucket}ly
                  </p>
                </div>
              </div>

              <dl className="relative mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] sm:grid-cols-4">
                {[
                  { label: 'Voltage', value: reading?.voltage != null ? `${reading.voltage.toFixed(1)} V` : 'Unavailable' },
                  { label: 'Current', value: reading?.current != null ? `${reading.current.toFixed(2)} A` : 'Unavailable' },
                  { label: 'Power factor', value: reading?.powerFactor != null ? reading.powerFactor.toFixed(2) : 'Unavailable' },
                  {
                    label: 'Temperature',
                    value: reading?.temperature != null ? `${reading.temperature.toFixed(1)} °C` : 'Unavailable',
                    icon: Thermometer,
                  },
                ].map((item) => (
                  <div key={item.label} className="bg-secondary/50 px-3 py-2.5 backdrop-blur-sm">
                    <dt className="text-[9px] uppercase tracking-[0.14em] text-secondary-foreground/45">
                      {item.label}
                    </dt>
                    <dd className="mt-0.5 text-xs font-medium text-secondary-foreground/90">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Bill + quick metrics */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <div className="panel relative overflow-hidden p-5">
                <span className="pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full bg-accent/15 blur-2xl" />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="eyebrow">This month's estimate</p>
                    <p className="metric mt-2 text-[32px] font-semibold leading-none">
                      {formatCurrency(data.totals.monthToDateCost, currency)}
                    </p>
                  </div>
                  <TrendPill value={monthChange} />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {formatKwh(data.totals.monthKwh)} measured · projected{' '}
                  <span className="font-medium text-foreground">
                    {formatCurrency(data.totals.projectedMonthlyCost, currency)}
                  </span>
                </p>

                {bill ? (
                  <>
                    <BreakdownBar
                      className="mt-4"
                      parts={[
                        { label: 'Energy', value: bill.energyCost, className: 'bg-primary' },
                        { label: 'Fixed', value: bill.fixedCharge, className: 'bg-chart-3' },
                        { label: 'Tax', value: bill.taxAmount, className: 'bg-accent' },
                      ]}
                    />
                    <div className="mt-3 space-y-1.5 text-[11px]">
                      {[
                        ['Energy charge', bill.energyCost],
                        ['Fixed charge', bill.fixedCharge],
                        ['Tax', bill.taxAmount],
                      ].map(([label, amount]) => (
                        <div key={String(label)} className="flex items-center justify-between">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="font-medium">{formatCurrency(Number(amount), currency)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/70 pt-3">
                  <span className="text-[10px] leading-relaxed text-muted-foreground">
                    Estimate only — your provider's bill wins.
                  </span>
                  <Button asChild variant="ghost" size="sm" className="shrink-0">
                    <Link to="/billing">Details</Link>
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="panel p-4">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/[0.08] text-primary">
                    <Gauge className="h-3.5 w-3.5" />
                  </span>
                  <p className="eyebrow mt-3">Energy today</p>
                  <p className="metric mt-1 text-xl font-semibold">{formatKwh(data.totals.todayKwh)}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">Since 00:00 UTC</p>
                </div>
                <div className="panel p-4">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/20 text-accent-foreground dark:text-accent">
                    <Zap className="h-3.5 w-3.5" />
                  </span>
                  <p className="eyebrow mt-3">Peak demand</p>
                  <p className="metric mt-1 text-xl font-semibold">
                    {peakPowerW != null ? formatPower(peakPowerW) : '—'}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">Highest bucket peak</p>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <div className="panel p-5 xl:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-sm font-semibold">Consumption trend</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {data.range.bucket === 'hour' ? 'Hourly' : 'Daily'} energy from your meter
                    {monthChange != null ? ` · ${Math.abs(monthChange).toFixed(0)}% ${monthChange >= 0 ? 'above' : 'below'} last month` : ''}
                  </p>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/energy-analytics">
                    Open analytics
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
              <div className="mt-4">
                {data.series.length > 0 ? (
                  <EnergyAreaChart
                    data={data.series}
                    granularity={data.range.bucket === 'hour' ? 'hour' : 'day'}
                    height={268}
                  />
                ) : (
                  <div className="flex h-[268px] items-center justify-center rounded-xl border border-dashed border-border">
                    <p className="text-xs text-muted-foreground">No readings in this range.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="panel flex flex-col p-5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-sm font-semibold">Live devices</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {data.onlineCount} of {data.deviceCount} online
                  </p>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/devices">
                    Manage
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>

              <ul className="mt-4 flex-1 divide-y divide-border/70">
                {data.live.map((device) => (
                  <li key={device.deviceId} className="flex items-center gap-3 py-3 first:pt-0">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/40">
                      <Cpu className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">{device.deviceName}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {device.lastSeenAt ? `Seen ${timeAgo(device.lastSeenAt)}` : 'Never reported'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="metric text-xs font-semibold">
                        {device.reading?.activePower != null ? formatPower(device.reading.activePower) : '—'}
                      </p>
                      <StatusDot status={device.status} className="mt-0.5 justify-end" />
                    </div>
                  </li>
                ))}
              </ul>

              <Link
                to="/wattbot"
                className="mt-3 flex items-center gap-2 rounded-xl border border-primary/15 bg-primary/[0.04] px-3 py-2.5 text-[11px] font-medium text-primary transition-colors hover:border-primary/30"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Ask WattBot about this household
                <ArrowUpRight className="ml-auto h-3.5 w-3.5" />
              </Link>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="panel p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/[0.08] text-primary">
                    <Lightbulb className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="font-display text-sm font-semibold">Energy intelligence</h2>
                    <p className="text-[11px] text-muted-foreground">Derived from your own readings</p>
                  </div>
                </div>
                <Badge variant="neutral">No guesswork</Badge>
              </div>

              {overview.isLoading ? <Skeleton className="mt-4 h-28" /> : null}
              {data.insights.length > 0 ? (
                <ul className="mt-4 space-y-2">
                  {data.insights.slice(0, 4).map((insight) => (
                    <li
                      key={insight.id}
                      className="group relative rounded-xl border border-border/70 bg-muted/20 p-3.5 transition-colors hover:bg-muted/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold">{insight.title}</p>
                        {insight.metric ? <Badge variant="outline">{insight.metric}</Badge> : null}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{insight.description}</p>
                    </li>
                  ))}
                </ul>
              ) : !overview.isLoading ? (
                <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
                  Not enough history yet to derive insights. A few days of readings unlock comparisons.
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-4">
              <div className="panel flex-1 p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Bell className="h-4 w-4" />
                    </span>
                    <div>
                      <h2 className="font-display text-sm font-semibold">Recent alerts</h2>
                      <p className="text-[11px] text-muted-foreground">
                        {unreadAlerts.length ? `${unreadAlerts.length} awaiting acknowledgement` : 'Nothing needs attention'}
                      </p>
                    </div>
                  </div>
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/alerts">All alerts</Link>
                  </Button>
                </div>

                {alerts.isLoading ? <Skeleton className="mt-4 h-24" /> : null}
                {alerts.data && alerts.data.length > 0 ? (
                  <ul className="mt-3 space-y-1">
                    {alerts.data.slice(0, 3).map((alert) => (
                      <li key={alert.id} className="flex items-start gap-3 rounded-xl px-1 py-2.5">
                        <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', severityTone[alert.severity])} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{alert.title}</p>
                          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{alert.message}</p>
                        </div>
                        <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                          {timeAgo(alert.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : !alerts.isLoading ? (
                  <p className="mt-5 text-xs text-muted-foreground">
                    No alerts. Thresholds you set in Alerts will surface here.
                  </p>
                ) : null}
              </div>

              <Link
                to="/wattbot"
                className="group relative overflow-hidden rounded-2xl border border-primary/15 bg-primary/[0.05] p-5 transition-colors hover:border-primary/30"
              >
                <span className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-accent/20 blur-2xl" />
                <div className="relative flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-display text-sm font-semibold">Ask WattBot about this month</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      “Why is my bill higher?” — answered from your stored readings, tariff and device state.
                    </p>
                  </div>
                  <ArrowUpRight className="ml-auto h-4 w-4 shrink-0 text-primary transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </div>
              </Link>
            </div>
          </section>

          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-relaxed text-muted-foreground">
            <Activity className="h-3 w-3" />
            <span>
              {simulated
                ? 'These readings are generated by the built-in simulator, not a physical meter.'
                : 'Readings come from your paired hardware.'}{' '}
              Money figures are estimates based on your configured tariff.
            </span>
          </p>
        </>
      ) : null}
    </div>
  );
}
