import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Cpu,
  Gauge,
  Lightbulb,
  PlugZap,
  Thermometer,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { EnergyPoint, Insight, LiveMetrics, CostBreakdown } from '@wattnexa/types';
import { formatCurrency, formatKwh, formatPower } from '@wattnexa/shared';
import { EnergyAreaChart } from '@/components/charts';
import { InlineError, MetricCard, PageHeader, SimulatedBadge, StatusDot } from '@/components/common';
import { Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/forms';
import { api } from '@/lib/api';
import { RANGE_OPTIONS, useHomes } from '@/lib/hooks';
import { useRealtime } from '@/lib/socket';
import { timeAgo } from '@/lib/utils';

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

export function Dashboard() {
  const { home, homeId, homes, select } = useHomes();
  const [range, setRange] = useState<string>('last_7_days');
  const queryClient = useQueryClient();

  const overview = useQuery({
    queryKey: ['overview', homeId, range],
    queryFn: () => api.get<Overview>(`/energy/overview?homeId=${homeId}&range=${range}`),
    enabled: Boolean(homeId),
    refetchInterval: 30_000,
  });

  useRealtime({
    'telemetry:new': () => void queryClient.invalidateQueries({ queryKey: ['overview'] }),
    'device:status': () => void queryClient.invalidateQueries({ queryKey: ['overview'] }),
  });

  const data = overview.data;
  const primary = data?.live[0];
  const reading = primary?.reading;
  const simulated = data?.simulated ?? false;
  const monthChange =
    data && data.totals.previousMonthKwh > 0
      ? ((data.totals.monthKwh - data.totals.previousMonthKwh) / data.totals.previousMonthKwh) * 100
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={home ? home.name : 'Overview'}
        description="Live consumption, billed in the currency you actually pay."
        actions={
          <>
            <SimulatedBadge simulated={simulated} />
            {homes.length > 1 ? (
              <Select value={homeId ?? ''} onChange={(event) => select(event.target.value)} className="w-40">
                {homes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            ) : null}
            <Select value={range} onChange={(event) => setRange(event.target.value)} className="w-40">
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </>
        }
      />

      {overview.isError ? (
        <InlineError message="Could not load your dashboard." onRetry={() => void overview.refetch()} />
      ) : null}

      {data && data.deviceCount === 0 ? (
        <EmptyState
          icon={Cpu}
          title="No device connected yet"
          description="Pair an ESP32 to start receiving readings, or explore the demo household that ships with the seed data."
          action={
            <Button asChild>
              <Link to="/app/devices">Add a device</Link>
            </Button>
          }
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Live power"
          value={reading?.activePower != null ? formatPower(reading.activePower) : null}
          icon={Zap}
          loading={overview.isLoading}
          accent
          hint={primary ? `${primary.deviceName} · ${primary.status}` : undefined}
        />
        <MetricCard
          label="Energy today"
          value={data ? formatKwh(data.totals.todayKwh) : null}
          icon={Gauge}
          loading={overview.isLoading}
          hint="Measured since 00:00 UTC"
        />
        <MetricCard
          label="This month"
          value={data ? formatKwh(data.totals.monthKwh) : null}
          icon={Activity}
          loading={overview.isLoading}
          hint={monthChange == null ? 'No previous month to compare' : `${monthChange >= 0 ? '+' : ''}${monthChange.toFixed(0)}% vs last month`}
        />
        <MetricCard
          label="Estimated bill"
          value={data ? formatCurrency(data.totals.monthToDateCost, data.tariff?.currency ?? 'INR') : null}
          icon={PlugZap}
          loading={overview.isLoading}
          hint={
            data
              ? `Projected ${formatCurrency(data.totals.projectedMonthlyCost, data.tariff?.currency ?? 'INR')} this month`
              : undefined
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Consumption</p>
              <p className="text-xs text-muted-foreground">
                {data ? `${data.series.length} ${data.range.bucket}ly buckets` : 'Loading series…'}
              </p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/app/energy">Details</Link>
            </Button>
          </div>
          {overview.isLoading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : data && data.series.length > 0 ? (
            <EnergyAreaChart data={data.series} granularity={data.range.bucket === 'hour' ? 'hour' : 'day'} />
          ) : (
            <EmptyState
              icon={Activity}
              title="No readings in this range"
              description="Pick a wider range, or pair a device to start collecting data."
            />
          )}
        </Card>

        <Card className="p-5">
          <p className="text-sm font-semibold">Live devices</p>
          {overview.isLoading ? (
            <div className="mt-4 space-y-3">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : data && data.live.length > 0 ? (
            <ul className="mt-3 divide-y divide-border">
              {data.live.map((device) => (
                <li key={device.deviceId} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{device.deviceName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {device.lastSeenAt ? `Seen ${timeAgo(device.lastSeenAt)}` : 'Never reported'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      {device.reading?.activePower != null ? formatPower(device.reading.activePower) : '—'}
                    </p>
                    <StatusDot status={device.status} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-xs text-muted-foreground">No devices yet.</p>
          )}

          {reading ? (
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-4 text-xs">
              <div>
                <p className="text-muted-foreground">Voltage</p>
                <p className="font-medium">{reading.voltage != null ? `${reading.voltage.toFixed(1)} V` : 'Not sensed'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Current</p>
                <p className="font-medium">{reading.current != null ? `${reading.current.toFixed(2)} A` : '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Power factor</p>
                <p className="font-medium">{reading.powerFactor != null ? reading.powerFactor.toFixed(2) : 'Unavailable'}</p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-muted-foreground">
                  <Thermometer className="h-3 w-3" /> Temperature
                </p>
                <p className="font-medium">
                  {reading.temperature != null ? `${reading.temperature.toFixed(1)} °C` : 'Unavailable'}
                </p>
              </div>
            </div>
          ) : null}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Lightbulb className="h-4 w-4 text-primary" />
              Insights
            </p>
            <Badge variant="neutral">From your data</Badge>
          </div>
          {overview.isLoading ? <Skeleton className="h-24" /> : null}
          <ul className="space-y-3">
            {(data?.insights ?? []).map((insight) => (
              <li key={insight.id} className="rounded-lg border border-border/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">{insight.title}</p>
                  {insight.metric ? <Badge variant="neutral">{insight.metric}</Badge> : null}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{insight.description}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold">Bill estimate</p>
            {data?.tariff ? (
              <Badge variant="outline">{data.tariff.provider ?? data.tariff.name}</Badge>
            ) : (
              <Button asChild size="sm" variant="outline">
                <Link to="/app/billing">Set tariff</Link>
              </Button>
            )}
          </div>
          {overview.isLoading ? <Skeleton className="h-24" /> : null}
          {data ? (
            <div className="space-y-2 text-xs">
              {[
                ['Energy charge', data.bill.breakdown.energyCost],
                ['Fixed charge', data.bill.breakdown.fixedCharge],
                ['Tax', data.bill.breakdown.taxAmount],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span>{formatCurrency(Number(value), data.tariff?.currency ?? 'INR')}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-border pt-2 text-sm font-semibold">
                <span>Month to date</span>
                <span>{formatCurrency(data.bill.breakdown.total, data.tariff?.currency ?? 'INR')}</span>
              </div>
              <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
                Estimate from your configured slabs and taxes. Your provider&apos;s bill remains authoritative.
              </p>
            </div>
          ) : null}
        </Card>
      </div>

      {monthChange != null ? (
        <Card className="flex items-center gap-3 p-4 text-xs">
          {monthChange >= 0 ? (
            <ArrowUpRight className="h-4 w-4 text-amber-500" />
          ) : (
            <ArrowDownRight className="h-4 w-4 text-emerald-500" />
          )}
          <span className="text-muted-foreground">
            Consumption is {Math.abs(monthChange).toFixed(0)}% {monthChange >= 0 ? 'higher' : 'lower'} than the same
            point last month ({formatKwh(data!.totals.previousMonthKwh)}).
          </span>
        </Card>
      ) : null}
    </div>
  );
}
