import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { EnergyPoint } from '@wattnexa/types';

const axisStyle = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };

const tooltipStyle = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 10,
  fontSize: 12,
  color: 'hsl(var(--card-foreground))',
  boxShadow: '0 12px 32px -18px rgba(0,0,0,0.5)',
};

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
}: {
  data: EnergyPoint[];
  granularity?: 'hour' | 'day';
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="energyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="timestamp"
          tickFormatter={(value: string) => labelFor(value, granularity)}
          tick={axisStyle}
          axisLine={false}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={44} unit=" kWh" />
        <Tooltip
          contentStyle={tooltipStyle}
          labelFormatter={(value) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', ...(granularity === 'hour' ? { timeStyle: 'short' } : {}) }).format(new Date(String(value)))}
          formatter={(value: number) => [`${Number(value).toFixed(2)} kWh`, 'Energy']}
        />
        <Area
          type="monotone"
          dataKey="energyKwh"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          fill="url(#energyFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function PowerLineChart({ data, height = 200 }: { data: EnergyPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="timestamp"
          tickFormatter={(value: string) => labelFor(value, 'hour')}
          tick={axisStyle}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={44} unit=" W" />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value: number, name: string) => [`${Number(value).toFixed(0)} W`, name === 'peakPowerW' ? 'Peak' : 'Average']}
        />
        <Line type="monotone" dataKey="averagePowerW" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="peakPowerW" stroke="hsl(var(--primary))" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
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
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tick={axisStyle} axisLine={false} tickLine={false} />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={44} unit=" kWh" />
        <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`${Number(value).toFixed(1)} kWh`, 'Energy']} />
        <Bar dataKey="kwh" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}
