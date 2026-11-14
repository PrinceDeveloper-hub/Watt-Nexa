import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowDownRight, ArrowUpRight, Download, FileText, Gauge, TrendingUp, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { EnergyPoint } from '@wattnexa/types';
import { formatKwh, formatPower, rangeLabel } from '@wattnexa/shared';
import { ComparisonBarChart, EnergyAreaChart, PowerLineChart } from '@/components/charts';
import { InlineError, PageHeader, Segmented, TrendPill } from '@/components/common';
import { EmptyState, Skeleton, Table, Td, Th } from '@/components/ui/feedback';
import { Pagination } from '@/components/pagination';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, downloadFile } from '@/lib/api';
import { useHomes } from '@/lib/hooks';
import { cn } from '@/lib/utils';

interface SeriesResponse {
  series: EnergyPoint[];
  bucket: 'hour' | 'day' | 'month';
  range: { from: string; to: string };
}

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: '7 days' },
  { value: 'last_30_days', label: '30 days' },
  { value: 'this_month', label: 'Month' },
  { value: 'last_90_days', label: '90 days' },
] as const;

type RangeValue = (typeof RANGES)[number]['value'];

const DAY_PARTS = [
  { key: 'morning', label: 'Morning', hint: '06:00–12:00', from: 6, to: 12, className: 'bg-chart-2' },
  { key: 'afternoon', label: 'Afternoon', hint: '12:00–17:00', from: 12, to: 17, className: 'bg-chart-4' },
  { key: 'evening', label: 'Evening', hint: '17:00–22:00', from: 17, to: 22, className: 'bg-chart-1' },
  { key: 'night', label: 'Night', hint: '22:00–06:00', from: 22, to: 30, className: 'bg-chart-5' },
] as const;

export function Energy() {
  const { homeId, home } = useHomes();
  const [range, setRange] = useState<RangeValue>('last_30_days');
  const [view, setView] = useState<'energy' | 'demand'>('energy');
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(10);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const { toast } = useToast();

  const series = useQuery({
    queryKey: ['energy-series', homeId, range],
    queryFn: () => api.get<SeriesResponse>(`/energy/series?homeId=${homeId}&range=${range}`),
    enabled: Boolean(homeId),
  });

  const comparison = useQuery({
    queryKey: ['energy-comparison', homeId],
    queryFn: () =>
      api.get<{ currentKwh: number; previousKwh: number; changePercent: number | null }>(
        `/energy/comparison?homeId=${homeId}`,
      ),
    enabled: Boolean(homeId),
  });

  // Hourly buckets for the last 7 days power the hour-of-day profile and the
  // time-of-day split. Same endpoint, explicit bucket override.
  const hourly = useQuery({
    queryKey: ['energy-hourly', homeId],
    queryFn: () => api.get<SeriesResponse>(`/energy/series?homeId=${homeId}&range=last_7_days&bucket=hour`),
    enabled: Boolean(homeId),
  });

  const points = series.data?.series ?? [];
  const totalKwh = points.reduce((sum, point) => sum + point.energyKwh, 0);
  const peak = points.reduce((max, point) => Math.max(max, point.peakPowerW), 0);
  const positive = points.filter((point) => point.averagePowerW > 0);
  const baseLoad = positive.length ? Math.min(...positive.map((point) => point.averagePowerW)) : 0;
  // Average per calendar day, so hourly ranges still read as "daily".
  const dailyTotals = points.reduce<Record<string, number>>((acc, point) => {
    const day = new Date(point.timestamp).toISOString().slice(0, 10);
    acc[day] = (acc[day] ?? 0) + point.energyKwh;
    return acc;
  }, {});
  const dayCount = Object.keys(dailyTotals).length;
  const avgDaily = dayCount ? totalKwh / dayCount : null;
  const averagePower = positive.length
    ? positive.reduce((sum, point) => sum + point.averagePowerW, 0) / positive.length
    : null;

  useEffect(() => {
    setTablePage(1);
  }, [range, tablePageSize]);

  const bucketTotalPages = Math.max(1, Math.ceil(points.length / tablePageSize));
  const safeTablePage = Math.min(tablePage, bucketTotalPages);
  const pagedPoints = points.slice((safeTablePage - 1) * tablePageSize, safeTablePage * tablePageSize);

  const bucketLabel = (timestamp: string) =>
    new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      ...(series.data?.bucket === 'hour' ? { hour: '2-digit', minute: '2-digit' } : {}),
      ...(series.data?.bucket === 'month' ? { year: 'numeric' } : {}),
    }).format(new Date(timestamp));

  const hourlyPoints = hourly.data?.series ?? [];
  const hourProfile = useMemo(() => {
    const buckets = Array.from({ length: 24 }, () => ({ sum: 0, count: 0 }));
    for (const point of hourlyPoints) {
      const hour = new Date(point.timestamp).getHours();
      buckets[hour].sum += point.energyKwh;
      buckets[hour].count += 1;
    }
    return buckets.map((bucket, hour) => ({
      hour,
      kwh: bucket.count ? bucket.sum / bucket.count : 0,
      hasData: bucket.count > 0,
    }));
  }, [hourlyPoints]);

  const dayParts = useMemo(() => {
    const totals: Record<string, number> = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    for (const point of hourlyPoints) {
      const hour = new Date(point.timestamp).getHours();
      const part = DAY_PARTS.find((candidate) =>
        candidate.from < candidate.to
          ? hour >= candidate.from && hour < candidate.to
          : hour >= candidate.from || hour < candidate.to % 24,
      );
      if (part) totals[part.key] += point.energyKwh;
    }
    const sum = Object.values(totals).reduce((acc, value) => acc + value, 0);
    return DAY_PARTS.map((part) => ({
      ...part,
      kwh: totals[part.key],
      share: sum > 0 ? (totals[part.key] / sum) * 100 : 0,
    }));
  }, [hourlyPoints]);

  const maxHour = Math.max(...hourProfile.map((entry) => entry.kwh), 0.001);
  const changePercent = comparison.data?.changePercent ?? null;

  const exportFile = async (kind: 'csv' | 'pdf') => {
    setExporting(kind);
    try {
      const query = `homeId=${homeId}&range=${range}`;
      if (kind === 'csv') {
        await downloadFile(`/reports/consumption.csv?${query}`, 'wattnexa-consumption.csv');
      } else {
        await downloadFile(`/reports/consumption.pdf?${query}`, 'wattnexa-report.pdf');
      }
      toast({ title: 'Export ready', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Energy analytics"
        description={home ? `${home.name} · ${rangeLabel(range)} · readings priced with your own tariff.` : 'Historical consumption'}
        actions={
          <>
            <Segmented ariaLabel="Analytics date range" options={RANGES} value={range} onChange={setRange} className="hidden md:inline-flex" />
            <Button variant="outline" size="sm" loading={exporting === 'csv'} onClick={() => void exportFile('csv')}>
              <Download />
              CSV
            </Button>
            <Button variant="outline" size="sm" loading={exporting === 'pdf'} onClick={() => void exportFile('pdf')}>
              <FileText />
              PDF
            </Button>
          </>
        }
      />

      <div className="md:hidden">
        <Segmented ariaLabel="Analytics date range" options={RANGES} value={range} onChange={setRange} className="w-full justify-between" />
      </div>

      {series.isError ? <InlineError message="Could not load consumption data." onRetry={() => void series.refetch()} /> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: 'Energy in range',
            value: formatKwh(totalKwh),
            hint: `${points.length} ${series.data?.bucket ?? 'day'}ly buckets`,
            icon: Zap,
          },
          {
            label: 'Average daily',
            value: avgDaily != null ? formatKwh(avgDaily) : '—',
            hint: `${dayCount} day${dayCount === 1 ? '' : 's'} with readings`,
            icon: Activity,
          },
          {
            label: 'Peak demand',
            value: peak > 0 ? formatPower(peak) : '—',
            hint: 'Highest bucket peak',
            icon: TrendingUp,
          },
          {
            label: 'Lowest average draw',
            value: baseLoad > 0 ? formatPower(baseLoad) : '—',
            hint: 'Standby floor',
            icon: Gauge,
          },
        ].map((tile) => (
          <div key={tile.label} className="panel p-4 sm:p-5">
            <div className="flex items-start justify-between">
              <p className="text-xs font-medium text-muted-foreground">{tile.label}</p>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-muted/40 text-primary">
                <tile.icon className="h-3.5 w-3.5" />
              </span>
            </div>
            {series.isLoading ? (
              <Skeleton className="mt-4 h-7 w-24" />
            ) : (
              <p className="metric mt-3 text-2xl font-semibold">{tile.value}</p>
            )}
            <p className="mt-1 text-[10px] text-muted-foreground">{tile.hint}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="panel p-5 xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-sm font-semibold">
                {view === 'energy' ? 'Consumption over time' : 'Average vs peak demand'}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {view === 'energy'
                  ? `Energy per ${series.data?.bucket ?? 'day'}ly bucket · dashed line is the average`
                  : 'Spikes matter for demand charges and safety'}
              </p>
            </div>
            <Segmented
              ariaLabel="Chart view"
              options={[
                { value: 'energy', label: 'Consumption' },
                { value: 'demand', label: 'Demand' },
              ]}
              value={view}
              onChange={setView}
            />
          </div>

          <div className="mt-4">
            {series.isLoading ? (
              <Skeleton className="h-[300px]" />
            ) : points.length > 0 ? (
              view === 'energy' ? (
                <EnergyAreaChart
                  data={points}
                  granularity={series.data?.bucket === 'hour' ? 'hour' : 'day'}
                  height={300}
                />
              ) : (
                <PowerLineChart data={points} height={300} />
              )
            ) : (
              <EmptyState
                className="py-12"
                icon={Activity}
                title="No readings in this range"
                description="Pick a wider range, or pair a device to start collecting data."
              />
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="panel relative overflow-hidden p-5">
            <span className="pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full bg-accent/15 blur-2xl" />
            <p className="eyebrow">Month vs last month</p>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="metric text-[30px] font-semibold leading-none">
                {comparison.data ? formatKwh(comparison.data.currentKwh) : '—'}
              </p>
              <TrendPill value={changePercent} />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {comparison.data
                ? `Compared with ${formatKwh(comparison.data.previousKwh)} across the whole of last month.`
                : 'Waiting for comparison data.'}
            </p>

            {comparison.data ? (
              <div className="mt-4 space-y-2.5">
                {[
                  { label: 'This month', value: comparison.data.currentKwh, className: 'bg-primary' },
                  { label: 'Last month', value: comparison.data.previousKwh, className: 'bg-chart-5/40' },
                ].map((row) => {
                  const max = Math.max(comparison.data!.currentKwh, comparison.data!.previousKwh, 0.001);
                  return (
                    <div key={row.label}>
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>{row.label}</span>
                        <span>{formatKwh(row.value)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn('h-full rounded-full', row.className)}
                          style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <p className="mt-4 flex items-start gap-1.5 border-t border-border/70 pt-3 text-[10px] leading-relaxed text-muted-foreground">
              {changePercent != null && changePercent >= 0 ? (
                <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
              ) : (
                <ArrowDownRight className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              )}
              Comparisons use month-to-date against the previous full month, never a savings claim.
            </p>
          </div>

          <div className="panel flex-1 p-5">
            <p className="eyebrow">Demand quality</p>
            <div className="mt-3 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Average draw</span>
                <span className="font-medium">{averagePower != null ? formatPower(averagePower) : '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Peak vs standby</span>
                <span className="font-medium">
                  {peak > 0 && baseLoad > 0 ? `${(peak / baseLoad).toFixed(1)}×` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Buckets with data</span>
                <span className="font-medium">{points.length}</span>
              </div>
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
              A single whole-house CT cannot attribute load to individual appliances.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="panel p-5 xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-sm font-semibold">Hourly usage analysis</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Average energy in each hour across the last 7 days of hourly buckets
              </p>
            </div>
            <span className="text-[10px] text-muted-foreground">{hourlyPoints.length} hourly buckets</span>
          </div>

          {hourly.isLoading ? (
            <Skeleton className="mt-6 h-40" />
          ) : hourlyPoints.length > 0 ? (
            <>
              <div className="mt-6 flex h-40 items-end gap-[3px]" aria-label="Average energy by hour of day">
                {hourProfile.map((entry) => (
                  <div key={entry.hour} className="group relative flex flex-1 flex-col items-center justify-end">
                    <div
                      className={cn(
                        'w-full rounded-t-[3px] transition-colors',
                        entry.hasData ? 'bg-primary/75 group-hover:bg-primary' : 'bg-muted',
                      )}
                      style={{ height: `${Math.max(3, (entry.kwh / maxHour) * 100)}%` }}
                      title={`${String(entry.hour).padStart(2, '0')}:00 · ${entry.kwh.toFixed(2)} kWh`}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[9px] text-muted-foreground">
                {['00', '06', '12', '18', '23'].map((hour) => (
                  <span key={hour}>{hour}:00</span>
                ))}
              </div>
            </>
          ) : (
            <p className="py-10 text-center text-xs text-muted-foreground">
              Hourly buckets are unavailable for this household yet.
            </p>
          )}
        </div>

        <div className="panel p-5">
          <h2 className="font-display text-sm font-semibold">Usage distribution</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Share of energy by time of day · last 7 days</p>

          {hourly.isLoading ? <Skeleton className="mt-4 h-32" /> : null}
          {hourlyPoints.length > 0 ? (
            <div className="mt-4 space-y-3">
              {dayParts.map((part) => (
                <div key={part.key}>
                  <div className="flex items-baseline justify-between text-[11px]">
                    <span className="font-medium">{part.label}</span>
                    <span className="text-muted-foreground">
                      {part.share.toFixed(0)}% · {formatKwh(part.kwh)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn('h-full rounded-full', part.className)} style={{ width: `${Math.max(1, part.share)}%` }} />
                  </div>
                  <p className="mt-0.5 text-[9px] text-muted-foreground">{part.hint}</p>
                </div>
              ))}
              <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
                Derived from your hourly readings, not from tariff peak/off-peak rules.
              </p>
            </div>
          ) : hourlyPoints.length === 0 && !hourly.isLoading ? (
            <p className="mt-6 text-xs text-muted-foreground">Not enough hourly history to distribute usage.</p>
          ) : null}
        </div>
      </section>

      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-sm font-semibold">Bucket totals</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The most recent {Math.min(points.length, 14)} buckets in range
            </p>
          </div>
          <span className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground">
            {rangeLabel(range)}
          </span>
        </div>
        <div className="mt-4">
          {series.isLoading ? (
            <Skeleton className="h-[220px]" />
          ) : points.length > 0 ? (
            <ComparisonBarChart
              data={points.slice(-14).map((point) => ({
                label:
                  series.data?.bucket === 'hour'
                    ? `${new Date(point.timestamp).getHours()}:00`
                    : new Date(point.timestamp).getDate().toString(),
                kwh: point.energyKwh,
              }))}
            />
          ) : (
            <p className="py-10 text-center text-xs text-muted-foreground">No readings in this range.</p>
          )}
        </div>
      </section>

      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-sm font-semibold">Bucket detail</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Every {series.data?.bucket ?? 'day'} in range, newest measurements included.
            </p>
          </div>
          <span className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground">
            {points.length} {series.data?.bucket ?? 'day'} buckets
          </span>
        </div>

        {series.isLoading ? (
          <Skeleton className="mt-4 h-56" />
        ) : points.length > 0 ? (
          <>
            <div className="mt-4 overflow-hidden rounded-xl border border-border/70">
              <Table>
                <thead>
                  <tr className="bg-muted/30">
                    <Th>Bucket</Th>
                    <Th className="text-right">Energy</Th>
                    <Th className="hidden text-right sm:table-cell">Average</Th>
                    <Th className="hidden text-right sm:table-cell">Peak</Th>
                    <Th className="text-right">Samples</Th>
                  </tr>
                </thead>
                <tbody>
                  {pagedPoints.map((point) => (
                    <tr key={point.timestamp}>
                      <Td className="text-xs">{bucketLabel(point.timestamp)}</Td>
                      <Td className="text-right text-xs font-medium tabular-nums">{point.energyKwh.toFixed(2)} kWh</Td>
                      <Td className="hidden text-right text-xs text-muted-foreground sm:table-cell">
                        {formatPower(point.averagePowerW)}
                      </Td>
                      <Td className="hidden text-right text-xs text-muted-foreground sm:table-cell">
                        {formatPower(point.peakPowerW)}
                      </Td>
                      <Td className="text-right text-xs text-muted-foreground">{point.samples}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <Pagination
              className="mt-3"
              page={safeTablePage}
              pageSize={tablePageSize}
              total={points.length}
              onPageChange={setTablePage}
              onPageSizeChange={setTablePageSize}
              pageSizeOptions={[10, 25, 50]}
              itemLabel="buckets"
            />
          </>
        ) : (
          <p className="py-8 text-center text-xs text-muted-foreground">No stored samples in this range.</p>
        )}
      </section>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Energy per bucket uses cumulative meter deltas where the device reports them; otherwise average power is
        integrated over the bucket and the result is an estimate. Zero stored samples are shown as no readings, never as
        0 kWh. Savings are never claimed without enough history.
      </p>
    </div>
  );
}
