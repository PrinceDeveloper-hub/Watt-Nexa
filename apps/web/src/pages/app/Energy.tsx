import { useQuery } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { useState } from 'react';
import type { EnergyPoint } from '@wattnexa/types';
import { formatKwh, formatPower, rangeLabel } from '@wattnexa/shared';
import { ComparisonBarChart, EnergyAreaChart, PowerLineChart } from '@/components/charts';
import { InlineError, MetricCard, PageHeader } from '@/components/common';
import { Skeleton } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/forms';
import { useToast } from '@/components/ui/toast';
import { api, downloadFile } from '@/lib/api';
import { RANGE_OPTIONS, useHomes } from '@/lib/hooks';

interface SeriesResponse {
  series: EnergyPoint[];
  bucket: 'hour' | 'day' | 'month';
  range: { from: string; to: string };
}

export function Energy() {
  const { homeId, home } = useHomes();
  const [range, setRange] = useState('last_30_days');
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

  const points = series.data?.series ?? [];
  const totalKwh = points.reduce((sum, point) => sum + point.energyKwh, 0);
  const peak = points.reduce((max, point) => Math.max(max, point.peakPowerW), 0);
  const positive = points.filter((point) => point.averagePowerW > 0);
  const baseLoad = positive.length ? Math.min(...positive.map((point) => point.averagePowerW)) : 0;

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
        title="Energy analytics"
        description={home ? `${home.name} · ${rangeLabel(range)}` : 'Historical consumption'}
        actions={
          <>
            <Select value={range} onChange={(event) => setRange(event.target.value)} className="w-40">
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
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

      {series.isError ? <InlineError message="Could not load consumption data." onRetry={() => void series.refetch()} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Energy in range" value={formatKwh(totalKwh)} loading={series.isLoading} />
        <MetricCard label="Peak demand" value={formatPower(peak)} loading={series.isLoading} />
        <MetricCard label="Lowest average draw" value={formatPower(baseLoad)} loading={series.isLoading} hint="Standby floor" />
        <MetricCard
          label="Month vs last month"
          value={comparison.data?.changePercent != null ? `${comparison.data.changePercent > 0 ? '+' : ''}${comparison.data.changePercent}%` : '—'}
          loading={comparison.isLoading}
          hint={comparison.data ? `${formatKwh(comparison.data.currentKwh)} vs ${formatKwh(comparison.data.previousKwh)}` : undefined}
        />
      </div>

      <Card className="p-5">
        <p className="text-sm font-semibold">Consumption over time</p>
        <p className="mb-4 text-xs text-muted-foreground">
          {series.data ? `${points.length} ${series.data.bucket}ly buckets` : 'Loading…'}
        </p>
        {series.isLoading ? (
          <Skeleton className="h-[280px]" />
        ) : points.length > 0 ? (
          <EnergyAreaChart data={points} granularity={series.data?.bucket === 'hour' ? 'hour' : 'day'} height={280} />
        ) : (
          <p className="py-12 text-center text-xs text-muted-foreground">No readings in this range.</p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <p className="text-sm font-semibold">Average vs peak power</p>
          <p className="mb-4 text-xs text-muted-foreground">Spikes matter for demand charges and safety.</p>
          {points.length > 0 ? <PowerLineChart data={points} /> : <Skeleton className="h-[200px]" />}
        </Card>
        <Card className="p-5">
          <p className="text-sm font-semibold">Daily totals</p>
          <p className="mb-4 text-xs text-muted-foreground">Last 14 buckets in range.</p>
          {points.length > 0 ? (
            <ComparisonBarChart
              data={points.slice(-14).map((point) => ({
                label: new Date(point.timestamp).getDate().toString(),
                kwh: point.energyKwh,
              }))}
            />
          ) : (
            <Skeleton className="h-[220px]" />
          )}
        </Card>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Energy per bucket uses cumulative meter deltas where the device reports them; otherwise average power is
        integrated over the bucket and the result is an estimate. Savings are never claimed without enough history.
      </p>
    </div>
  );
}
