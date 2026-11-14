import { useId } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { EnergyPoint } from '@wattnexa/types';
import { cn } from '@/lib/utils';

const axisStyle = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };

interface TooltipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

function ChartTooltip({
  active,
  payload,
  label,
  suffix = '',
  seriesLabel,
  formatLabel,
}: {
  active?: boolean;
  payload?: ReadonlyArray<TooltipEntry>;
  label?: string | number;
  suffix?: string;
  seriesLabel?: string;
  formatLabel?: (value: string | number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[148px] rounded-xl border border-border bg-card/95 px-3 py-2.5 shadow-lift backdrop-blur">
      {label != null ? (
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {formatLabel ? formatLabel(label) : String(label)}
        </p>
      ) : null}
      <div className="mt-1.5 space-y-1">
        {payload.map((entry, index) => (
          <div key={`${String(entry.dataKey)}-${index}`} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: entry.color ?? 'hsl(var(--primary))' }}
              />
              {seriesLabel && payload.length === 1
                ? seriesLabel
                : entry.name === 'peakPowerW'
                  ? 'Peak'
                  : entry.name === 'averagePowerW'
                    ? 'Average'
                    : 'Energy'}
            </span>
            <span className="font-display text-[12px] font-semibold tabular-nums">
              {typeof entry.value === 'number' ? entry.value.toFixed(entry.value < 10 ? 2 : 0) : entry.value}
              {suffix}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function labelFor(timestamp: string, granularity: 'hour' | 'day'): string {
  const date = new Date(timestamp);
  if (granularity === 'hour') {
    return `${date.getDate()}/${date.getMonth() + 1} ${String(date.getHours()).padStart(2, '0')}:00`;
  }
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

export function EnergyAreaChart({
  data,
  granularity = 'day',
  height = 260,
  showAverage = true,
}: {
  data: EnergyPoint[];
  granularity?: 'hour' | 'day';
  height?: number;
  showAverage?: boolean;
}) {
  const gradientId = `energy-fill-${useId().replace(/:/g, '')}`;
  const average =
    data.length > 0 ? data.reduce((sum, point) => sum + point.energyKwh, 0) / data.length : 0;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 12, right: 6, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.32} />
            <stop offset="65%" stopColor="hsl(var(--chart-1))" stopOpacity={0.08} />
            <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 6" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="timestamp"
          tickFormatter={(value: string) => labelFor(value, granularity)}
          tick={axisStyle}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
          dy={4}
        />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={48} unit=" kWh" />
        <Tooltip
          cursor={{ stroke: 'hsl(var(--border))', strokeDasharray: '3 4' }}
          content={
            <ChartTooltip
              suffix=" kWh"
              seriesLabel="Energy"
              formatLabel={(value) =>
                new Intl.DateTimeFormat('en-IN', {
                  dateStyle: 'medium',
                  ...(granularity === 'hour' ? { timeStyle: 'short' } : {}),
                }).format(new Date(String(value)))
              }
            />
          }
        />
        {showAverage && data.length > 2 && average > 0 ? (
          <ReferenceLine
            y={average}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="4 5"
            strokeOpacity={0.45}
            label={{
              value: 'avg',
              position: 'insideTopRight',
              fill: 'hsl(var(--muted-foreground))',
              fontSize: 10,
            }}
          />
        ) : null}
        <Area
          type="monotone"
          dataKey="energyKwh"
          stroke="hsl(var(--chart-1))"
          strokeWidth={2.25}
          fill={`url(#${gradientId})`}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))', fill: 'hsl(var(--chart-1))' }}
          animationDuration={700}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function PowerLineChart({ data, height = 200 }: { data: EnergyPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 6, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 6" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="timestamp"
          tickFormatter={(value: string) => labelFor(value, 'hour')}
          tick={axisStyle}
          axisLine={false}
          tickLine={false}
          minTickGap={32}
          dy={4}
        />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={48} unit=" W" />
        <Tooltip
          cursor={{ stroke: 'hsl(var(--border))', strokeDasharray: '3 4' }}
          content={<ChartTooltip suffix=" W" />}
        />
        <Line
          type="monotone"
          dataKey="averagePowerW"
          name="averagePowerW"
          stroke="hsl(var(--chart-3))"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3.5, strokeWidth: 2, stroke: 'hsl(var(--card))' }}
          animationDuration={650}
        />
        <Line
          type="monotone"
          dataKey="peakPowerW"
          name="peakPowerW"
          stroke="hsl(var(--chart-4))"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
          animationDuration={650}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ComparisonBarChart({
  data,
  height = 220,
}: {
  data: Array<{ label: string; kwh: number }>;
  height?: number;
}) {
  const gradientId = `bar-fill-${useId().replace(/:/g, '')}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 6, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.95} />
            <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.42} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 6" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tick={axisStyle} axisLine={false} tickLine={false} dy={4} />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={48} unit=" kWh" />
        <Tooltip
          cursor={{ fill: 'hsl(var(--muted) / 0.45)' }}
          content={<ChartTooltip suffix=" kWh" seriesLabel="Energy" />}
        />
        <Bar
          dataKey="kwh"
          fill={`url(#${gradientId})`}
          radius={[6, 6, 2, 2]}
          maxBarSize={44}
          animationDuration={650}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Lightweight SVG sparkline for hero panels and inline trends. */
export function Sparkline({
  values,
  className,
  height = 56,
  fill = true,
}: {
  values: number[];
  className?: string;
  height?: number;
  fill?: boolean;
}) {
  const gradientId = `spark-${useId().replace(/:/g, '')}`;
  if (values.length < 2) {
    return <div className={cn('w-full', className)} style={{ height }} aria-hidden="true" />;
  }
  const width = 100;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 4 - ((value - min) / span) * (height - 10);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const area = `0,${height} ${points.join(' ')} ${width},${height}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('w-full', className)}
      style={{ height }}
      role="img"
      aria-label="Trend sparkline"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill ? <polygon points={area} fill={`url(#${gradientId})`} /> : null}
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
