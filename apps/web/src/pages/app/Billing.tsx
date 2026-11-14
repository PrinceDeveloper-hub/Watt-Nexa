import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Info, Plus, Receipt, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatCurrency, formatKwh } from '@wattnexa/shared';
import { BreakdownBar, InlineError, PageHeader } from '@/components/common';
import {
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
  Table,
  Td,
  Th,
} from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/forms';
import { Pagination } from '@/components/pagination';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useHomes } from '@/lib/hooks';

interface Estimate {
  energyKwh: number;
  energyCost: number;
  fixedCharge: number;
  taxAmount: number;
  total: number;
  currency: string;
  slabs: Array<{ label: string; kwh: number; ratePerKwh: number; cost: number }>;
  projection: { projectedKwh: number; projectedTotal: number };
  tariff: { id: string; name: string; provider: string | null } | null;
  periodStart: string;
  periodEnd: string;
  disclaimer: string;
}

interface Tariff {
  id: string;
  name: string;
  provider: string | null;
  currency: string;
  fixedCharge: number;
  taxPercent: number;
  isActive: boolean;
  slabs: Array<{ minKwh: number; maxKwh: number | null; ratePerKwh: number }>;
}

interface Appliance {
  id: string;
  name: string;
  category: string;
  ratedPowerW: number;
  estimatedHoursPerDay: number;
  estimatedMonthlyKwh: number;
  estimatedMonthlyCost: number | null;
  measurementType: 'estimated';
}

interface RecordedBill {
  id: string;
  periodStart: string;
  periodEnd: string;
  energyKwh: number;
  estimatedCost: number;
  actualCost: number | null;
  currency: string;
  status: 'estimated' | 'actual';
  notes: string | null;
}

const emptySlab = { minKwh: 0, maxKwh: 100 as number | null, ratePerKwh: 5 };

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function currentPeriod() {
  const now = new Date();
  return {
    start: isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
    end: isoDate(now),
  };
}

export function Billing() {
  const { homeId, home } = useHomes();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tariffOpen, setTariffOpen] = useState(false);
  const [applianceOpen, setApplianceOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [billPage, setBillPage] = useState(1);
  const [billPageSize, setBillPageSize] = useState(5);
  const initialPeriod = currentPeriod();
  const [billForm, setBillForm] = useState({
    periodStart: initialPeriod.start,
    periodEnd: initialPeriod.end,
    energyKwh: '',
    actualCost: '',
    notes: '',
  });

  const estimate = useQuery({
    queryKey: ['estimate', homeId],
    queryFn: () => api.get<Estimate>(`/billing/estimate?homeId=${homeId}&range=this_month`),
    enabled: Boolean(homeId),
  });
  const previousEstimate = useQuery({
    queryKey: ['estimate', homeId, 'previous_month'],
    queryFn: () => api.get<Estimate>(`/billing/estimate?homeId=${homeId}&range=previous_month`),
    enabled: Boolean(homeId),
  });
  const tariffs = useQuery({
    queryKey: ['tariffs', homeId],
    queryFn: () => api.get<Tariff[]>(`/billing/tariffs?homeId=${homeId}`),
    enabled: Boolean(homeId),
  });
  const appliances = useQuery({
    queryKey: ['appliances', homeId],
    queryFn: () => api.get<Appliance[]>(`/billing/appliances?homeId=${homeId}`),
    enabled: Boolean(homeId),
  });
  const bills = useQuery({
    queryKey: ['bills', homeId],
    queryFn: () => api.get<RecordedBill[]>(`/billing/bills?homeId=${homeId}`),
    enabled: Boolean(homeId),
  });

  useEffect(() => {
    setBillPage(1);
  }, [billPageSize, homeId]);

  const [tariffForm, setTariffForm] = useState({
    name: 'My tariff',
    provider: '',
    fixedCharge: '100',
    taxPercent: '0',
    slabs: [
      emptySlab,
      { minKwh: 100, maxKwh: 300 as number | null, ratePerKwh: 7 },
      { minKwh: 300, maxKwh: null as number | null, ratePerKwh: 9 },
    ],
  });
  const [applianceForm, setApplianceForm] = useState({
    name: '',
    category: 'Kitchen',
    ratedPowerW: '100',
    hours: '2',
  });

  const saveTariff = useMutation({
    mutationFn: () =>
      api.post('/billing/tariffs?homeId=' + homeId, {
        name: tariffForm.name,
        provider: tariffForm.provider || undefined,
        currency: 'INR',
        fixedCharge: Number(tariffForm.fixedCharge),
        taxPercent: Number(tariffForm.taxPercent),
        slabs: tariffForm.slabs.map((slab) => ({
          minKwh: Number(slab.minKwh),
          maxKwh: slab.maxKwh == null ? null : Number(slab.maxKwh),
          ratePerKwh: Number(slab.ratePerKwh),
        })),
      }),
    onSuccess: async () => {
      setTariffOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['estimate'] });
      await queryClient.invalidateQueries({ queryKey: ['tariffs'] });
      toast({ title: 'Tariff saved', variant: 'success' });
    },
    onError: (error) => toast({ title: 'Could not save tariff', description: error.message, variant: 'error' }),
  });

  const addAppliance = useMutation({
    mutationFn: () =>
      api.post('/billing/appliances', {
        homeId,
        name: applianceForm.name,
        category: applianceForm.category,
        ratedPowerW: Number(applianceForm.ratedPowerW),
        estimatedHoursPerDay: Number(applianceForm.hours),
      }),
    onSuccess: async () => {
      setApplianceOpen(false);
      setApplianceForm({ name: '', category: 'Kitchen', ratedPowerW: '100', hours: '2' });
      await queryClient.invalidateQueries({ queryKey: ['appliances'] });
      toast({ title: 'Appliance added', variant: 'success' });
    },
    onError: (error) => toast({ title: 'Could not add appliance', description: error.message, variant: 'error' }),
  });

  const removeAppliance = useMutation({
    mutationFn: (id: string) => api.del(`/billing/appliances/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['appliances'] }),
  });

  const recordBill = useMutation({
    mutationFn: () =>
      api.post('/billing/bills', {
        homeId,
        periodStart: new Date(`${billForm.periodStart}T00:00:00Z`).toISOString(),
        periodEnd: new Date(`${billForm.periodEnd}T23:59:59Z`).toISOString(),
        energyKwh: Number(billForm.energyKwh),
        actualCost: Number(billForm.actualCost),
        notes: billForm.notes || undefined,
      }),
    onSuccess: async () => {
      setBillOpen(false);
      setBillForm({ ...billForm, energyKwh: '', actualCost: '', notes: '' });
      await queryClient.invalidateQueries({ queryKey: ['bills'] });
      toast({ title: 'Provider bill recorded', variant: 'success' });
    },
    onError: (error) => toast({ title: 'Could not record bill', description: error.message, variant: 'error' }),
  });

  const activeTariff = tariffs.data?.find((tariff) => tariff.isActive) ?? tariffs.data?.[0];
  const bill = estimate.data;
  const previous = previousEstimate.data;
  const effectiveRate = bill && bill.energyKwh > 0 ? bill.total / bill.energyKwh : null;
  const change =
    bill && previous && previous.total > 0 ? ((bill.total - previous.total) / previous.total) * 100 : null;
  const applianceTotalKwh = (appliances.data ?? []).reduce((sum, item) => sum + item.estimatedMonthlyKwh, 0);
  const applianceMax = Math.max(...(appliances.data ?? []).map((item) => item.estimatedMonthlyKwh), 0.001);
  const billRows = bills.data ?? [];
  const billTotalPages = Math.max(1, Math.ceil(billRows.length / billPageSize));
  const safeBillPage = Math.min(billPage, billTotalPages);
  const pagedBills = billRows.slice((safeBillPage - 1) * billPageSize, safeBillPage * billPageSize);
  const cycleLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date());

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Money"
        title="Billing"
        description={
          home
            ? `Estimated costs for ${home.name} · priced with your own slabs, fixed charge and tax.`
            : 'Tariffs and estimates.'
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setApplianceOpen(true)}>
              <Plus />
              Appliance
            </Button>
            <Button onClick={() => setTariffOpen(true)}>
              <Plus />
              {activeTariff ? 'Replace tariff' : 'Add tariff'}
            </Button>
          </>
        }
      />

      {estimate.isError ? <InlineError message="Could not load the estimate." onRetry={() => void estimate.refetch()} /> : null}

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="panel relative overflow-hidden p-5 sm:p-6 xl:col-span-2">
          <span className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-accent/10 blur-3xl" />
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Current estimated bill</p>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <p className="metric text-[40px] font-semibold leading-none sm:text-[52px]">
                  {bill ? formatCurrency(bill.total, bill.currency) : '—'}
                </p>
                <Badge variant="neutral">
                  <Receipt className="h-3 w-3" />
                  Estimate
                </Badge>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {cycleLabel} · {bill ? formatKwh(bill.energyKwh) : '—'} measured to date
              </p>
            </div>
            <div className="text-right">
              <p className="eyebrow">Projected month</p>
              <p className="metric mt-1 text-xl font-semibold">
                {bill ? formatCurrency(bill.projection.projectedTotal, bill.currency) : '—'}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {bill ? formatKwh(bill.projection.projectedKwh) : '—'} at this pace
              </p>
            </div>
          </div>

          {estimate.isLoading ? <Skeleton className="mt-6 h-40" /> : null}

          {bill ? (
            <>
              <BreakdownBar
                className="mt-6 h-2.5"
                parts={[
                  { label: 'Energy', value: bill.energyCost, className: 'bg-primary' },
                  { label: 'Fixed', value: bill.fixedCharge, className: 'bg-chart-3' },
                  { label: 'Tax', value: bill.taxAmount, className: 'bg-accent' },
                ]}
              />
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                {[
                  { label: 'Energy', value: bill.energyCost, dot: 'bg-primary' },
                  { label: 'Fixed', value: bill.fixedCharge, dot: 'bg-chart-3' },
                  { label: 'Tax', value: bill.taxAmount, dot: 'bg-accent' },
                ].map((item) => (
                  <span key={item.label} className="inline-flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${item.dot}`} />
                    {item.label} {formatCurrency(item.value, bill.currency)}
                  </span>
                ))}
              </div>

              <div className="mt-5 overflow-hidden rounded-xl border border-border/70">
                <Table>
                  <thead>
                    <tr className="bg-muted/30">
                      <Th>Slab</Th>
                      <Th className="text-right">Units</Th>
                      <Th className="text-right">Rate</Th>
                      <Th className="text-right">Cost</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {bill.slabs.map((slab) => (
                      <tr key={slab.label}>
                        <Td className="text-xs">{slab.label}</Td>
                        <Td className="text-right text-xs tabular-nums">{slab.kwh.toFixed(1)} kWh</Td>
                        <Td className="text-right text-xs text-muted-foreground">₹{slab.ratePerKwh}/unit</Td>
                        <Td className="text-right text-xs font-medium">{formatCurrency(slab.cost, bill.currency)}</Td>
                      </tr>
                    ))}
                    <tr>
                      <Td className="text-xs text-muted-foreground" colSpan={3}>
                        Fixed charge
                      </Td>
                      <Td className="text-right text-xs font-medium">{formatCurrency(bill.fixedCharge, bill.currency)}</Td>
                    </tr>
                    <tr>
                      <Td className="text-xs text-muted-foreground" colSpan={3}>
                        Tax
                      </Td>
                      <Td className="text-right text-xs font-medium">{formatCurrency(bill.taxAmount, bill.currency)}</Td>
                    </tr>
                    <tr className="bg-muted/30">
                      <Td className="text-xs font-semibold" colSpan={3}>
                        Month to date
                      </Td>
                      <Td className="text-right text-sm font-semibold">{formatCurrency(bill.total, bill.currency)}</Td>
                    </tr>
                  </tbody>
                </Table>
              </div>

              <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                {bill.disclaimer} Slabs apply progressively; units above the last slab use the last rate rather than being
                dropped.
              </p>
            </>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <div className="panel flex-1 p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-sm font-semibold">Active tariff</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {activeTariff ? `${activeTariff.name}${activeTariff.provider ? ` · ${activeTariff.provider}` : ''}` : 'Not configured'}
                </p>
              </div>
              {activeTariff ? <Badge variant="outline">{activeTariff.currency}</Badge> : null}
            </div>

            {tariffs.isLoading ? <Skeleton className="mt-4 h-32" /> : null}

            {activeTariff ? (
              <div className="mt-4 space-y-2">
                {activeTariff.slabs
                  .slice()
                  .sort((a, b) => a.minKwh - b.minKwh)
                  .map((slab, index, list) => {
                    const next = list[index + 1];
                    // Share of this month's measured units that fell inside this slab.
                    const slabUnits = bill?.slabs[index]?.kwh ?? 0;
                    const usedShare =
                      bill && bill.energyKwh > 0 ? Math.min(100, (slabUnits / bill.energyKwh) * 100) : 0;
                    return (
                      <div
                        key={`${slab.minKwh}-${slab.maxKwh}`}
                        className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-medium">
                            {slab.minKwh}–{slab.maxKwh ?? '∞'} kWh
                          </span>
                          <span className="text-muted-foreground">₹{slab.ratePerKwh}/unit</span>
                        </div>
                        {next ? (
                          <p className="mt-0.5 text-[9px] text-muted-foreground">
                            Next rate starts after {slab.maxKwh ?? next.minKwh} kWh
                          </p>
                        ) : (
                          <p className="mt-0.5 text-[9px] text-muted-foreground">Highest slab — applies to remaining units</p>
                        )}
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary/60" style={{ width: `${usedShare}%` }} />
                        </div>
                      </div>
                    );
                  })}
                <div className="flex items-center justify-between border-t border-border/70 pt-2 text-[11px]">
                  <span className="text-muted-foreground">Fixed charge</span>
                  <span className="font-medium">₹{activeTariff.fixedCharge}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Tax</span>
                  <span className="font-medium">{activeTariff.taxPercent}%</span>
                </div>
                <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => setTariffOpen(true)}>
                  Adjust tariff
                </Button>
              </div>
            ) : (
              <div className="mt-4">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Add your provider and slabs to turn kWh into rupees. Until then, energy stays unit-only.
                </p>
                <Button className="mt-3 w-full" size="sm" onClick={() => setTariffOpen(true)}>
                  Add tariff
                </Button>
              </div>
            )}
          </div>

          <div className="panel p-5">
            <h2 className="font-display text-sm font-semibold">Cost anatomy</h2>
            <dl className="mt-3 space-y-2.5 text-[11px]">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Effective rate</dt>
                <dd className="font-medium">{effectiveRate != null ? `₹${effectiveRate.toFixed(2)}/kWh` : '—'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Previous month estimate</dt>
                <dd className="font-medium">
                  {previous ? formatCurrency(previous.total, previous.currency) : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Change</dt>
                <dd className="inline-flex items-center gap-1 font-medium">
                  {change == null ? (
                    '—'
                  ) : (
                    <>
                      {change >= 0 ? (
                        <TrendingUp className="h-3 w-3 text-warning" />
                      ) : (
                        <TrendingDown className="h-3 w-3 text-primary" />
                      )}
                      {change >= 0 ? '+' : ''}
                      {change.toFixed(0)}%
                    </>
                  )}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[9px] leading-relaxed text-muted-foreground">
              The previous month is an estimate at today's tariff, not an issued bill.
            </p>
          </div>
        </div>
      </section>

      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-semibold">Appliance estimates</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Manual estimates from rated power × hours. A single whole-house CT cannot measure these individually.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setApplianceOpen(true)}>
            <Plus />
            Add appliance
          </Button>
        </div>

        {appliances.isLoading ? <Skeleton className="mt-4 h-32" /> : null}

        {appliances.data && appliances.data.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-border/70">
            <Table>
              <thead>
                <tr className="bg-muted/30">
                  <Th>Appliance</Th>
                  <Th className="hidden sm:table-cell">Rated power</Th>
                  <Th className="hidden sm:table-cell">Hours/day</Th>
                  <Th>Est. kWh/month</Th>
                  <Th>Est. cost</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {appliances.data.map((appliance) => (
                  <tr key={appliance.id}>
                    <Td>
                      <p className="text-xs font-medium">{appliance.name}</p>
                      <p className="text-[10px] text-muted-foreground">{appliance.category}</p>
                      <div className="mt-1.5 h-1 max-w-[160px] overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{ width: `${Math.max(2, (appliance.estimatedMonthlyKwh / applianceMax) * 100)}%` }}
                        />
                      </div>
                    </Td>
                    <Td className="hidden text-xs sm:table-cell">{appliance.ratedPowerW} W</Td>
                    <Td className="hidden text-xs sm:table-cell">{appliance.estimatedHoursPerDay}</Td>
                    <Td className="text-xs tabular-nums">{appliance.estimatedMonthlyKwh.toFixed(1)}</Td>
                    <Td className="text-xs">
                      {appliance.estimatedMonthlyCost != null
                        ? formatCurrency(appliance.estimatedMonthlyCost, 'INR')
                        : '—'}
                    </Td>
                    <Td className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${appliance.name}`}
                        onClick={() => removeAppliance.mutate(appliance.id)}
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : !appliances.isLoading ? (
          <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <p className="text-xs font-medium">No appliances yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-muted-foreground">
              Add an appliance to estimate its share of the bill from its rating and daily runtime.
            </p>
          </div>
        ) : null}

        {appliances.data && appliances.data.length > 0 ? (
          <p className="mt-3 text-[10px] text-muted-foreground">
            Your appliance estimates total {formatKwh(applianceTotalKwh)} per month — a planning figure, not a measurement.
          </p>
        ) : null}
      </section>

      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/[0.08] text-primary">
              <CalendarClock className="h-4 w-4" />
            </span>
            <div>
              <h2 className="font-display text-sm font-semibold">Provider bills</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Record the amount your provider actually charged and compare it with the tariff estimate.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setBillOpen(true)}>
            <Plus />
            Record actual bill
          </Button>
        </div>

        {bills.isLoading ? <Skeleton className="mt-4 h-32" /> : null}

        {billRows.length > 0 ? (
          <>
            <div className="mt-4 overflow-hidden rounded-xl border border-border/70">
              <Table>
                <thead>
                  <tr className="bg-muted/30">
                    <Th>Period</Th>
                    <Th className="text-right">Energy</Th>
                    <Th className="text-right">Estimate</Th>
                    <Th className="text-right">Provider bill</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {pagedBills.map((bill) => (
                    <tr key={bill.id}>
                      <Td className="text-xs">
                        {new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(
                          new Date(bill.periodStart),
                        )}
                        {bill.notes ? (
                          <p className="mt-0.5 max-w-[220px] truncate text-[10px] text-muted-foreground">{bill.notes}</p>
                        ) : null}
                      </Td>
                      <Td className="text-right text-xs tabular-nums">{bill.energyKwh.toFixed(1)} kWh</Td>
                      <Td className="text-right text-xs text-muted-foreground">
                        {formatCurrency(bill.estimatedCost, bill.currency)}
                      </Td>
                      <Td className="text-right text-xs font-medium">
                        {bill.actualCost != null ? formatCurrency(bill.actualCost, bill.currency) : '—'}
                      </Td>
                      <Td>
                        <Badge variant={bill.status === 'actual' ? 'default' : 'neutral'}>
                          {bill.status === 'actual' ? 'Recorded' : 'Estimated'}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <Pagination
              className="mt-3"
              page={safeBillPage}
              pageSize={billPageSize}
              total={billRows.length}
              onPageChange={setBillPage}
              onPageSizeChange={setBillPageSize}
              pageSizeOptions={[5, 10, 25]}
              itemLabel="bills"
            />
          </>
        ) : !bills.isLoading ? (
          <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <p className="text-xs font-medium">No provider bills recorded</p>
            <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-muted-foreground">
              Record the real amount when it arrives. It is stored separately and never overwrites the estimate.
            </p>
          </div>
        ) : null}
      </section>

      <Dialog open={billOpen} onOpenChange={setBillOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a provider bill</DialogTitle>
            <DialogDescription>
              This stores the official amount alongside the tariff estimate. It does not change your readings or
              estimates.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Period start">
                <Input
                  type="date"
                  value={billForm.periodStart}
                  onChange={(event) => setBillForm({ ...billForm, periodStart: event.target.value })}
                />
              </Field>
              <Field label="Period end">
                <Input
                  type="date"
                  value={billForm.periodEnd}
                  onChange={(event) => setBillForm({ ...billForm, periodEnd: event.target.value })}
                />
              </Field>
              <Field label="Billed energy (kWh)">
                <Input
                  type="number"
                  step="0.1"
                  value={billForm.energyKwh}
                  onChange={(event) => setBillForm({ ...billForm, energyKwh: event.target.value })}
                  placeholder="312.4"
                />
              </Field>
              <Field label="Provider bill (₹)">
                <Input
                  type="number"
                  step="0.01"
                  value={billForm.actualCost}
                  onChange={(event) => setBillForm({ ...billForm, actualCost: event.target.value })}
                  placeholder="2840"
                />
              </Field>
            </div>
            <Field label="Notes" hint="Optional — meter number, billing period quirks, adjustments.">
              <Textarea
                value={billForm.notes}
                onChange={(event) => setBillForm({ ...billForm, notes: event.target.value })}
                placeholder="Provider bill for the October cycle"
              />
            </Field>
            <Button
              className="w-full"
              onClick={() => recordBill.mutate()}
              loading={recordBill.isPending}
              disabled={
                !billForm.periodStart ||
                !billForm.periodEnd ||
                !billForm.energyKwh ||
                !billForm.actualCost
              }
            >
              Save provider bill
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={tariffOpen} onOpenChange={setTariffOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Configure tariff</DialogTitle>
            <DialogDescription>
              Progressive slabs: each rate applies only to units inside its range. Replacing a tariff deactivates the
              previous one for this household.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input value={tariffForm.name} onChange={(e) => setTariffForm({ ...tariffForm, name: e.target.value })} />
              </Field>
              <Field label="Provider">
                <Input
                  value={tariffForm.provider}
                  onChange={(e) => setTariffForm({ ...tariffForm, provider: e.target.value })}
                  placeholder="BESCOM"
                />
              </Field>
              <Field label="Fixed charge (₹)">
                <Input
                  type="number"
                  value={tariffForm.fixedCharge}
                  onChange={(e) => setTariffForm({ ...tariffForm, fixedCharge: e.target.value })}
                />
              </Field>
              <Field label="Tax (%)" hint="Applied on the energy and fixed charges.">
                <Input
                  type="number"
                  value={tariffForm.taxPercent}
                  onChange={(e) => setTariffForm({ ...tariffForm, taxPercent: e.target.value })}
                />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">Slabs (kWh)</p>
                <p className="text-[10px] text-muted-foreground">Start · End (blank = ∞) · ₹/unit</p>
              </div>
              {tariffForm.slabs.map((slab, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                  <Input
                    type="number"
                    value={slab.minKwh}
                    aria-label={`Slab ${index + 1} start`}
                    onChange={(e) => {
                      const slabs = [...tariffForm.slabs];
                      slabs[index] = { ...slab, minKwh: Number(e.target.value) };
                      setTariffForm({ ...tariffForm, slabs });
                    }}
                  />
                  <Input
                    type="number"
                    value={slab.maxKwh ?? ''}
                    aria-label={`Slab ${index + 1} end`}
                    placeholder="∞"
                    onChange={(e) => {
                      const slabs = [...tariffForm.slabs];
                      slabs[index] = { ...slab, maxKwh: e.target.value === '' ? null : Number(e.target.value) };
                      setTariffForm({ ...tariffForm, slabs });
                    }}
                  />
                  <Input
                    type="number"
                    value={slab.ratePerKwh}
                    aria-label={`Slab ${index + 1} rate`}
                    onChange={(e) => {
                      const slabs = [...tariffForm.slabs];
                      slabs[index] = { ...slab, ratePerKwh: Number(e.target.value) };
                      setTariffForm({ ...tariffForm, slabs });
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove slab ${index + 1}`}
                    disabled={tariffForm.slabs.length <= 1}
                    onClick={() =>
                      setTariffForm({
                        ...tariffForm,
                        slabs: tariffForm.slabs.filter((_, slabIndex) => slabIndex !== index),
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const last = tariffForm.slabs[tariffForm.slabs.length - 1];
                  setTariffForm({
                    ...tariffForm,
                    slabs: [
                      ...tariffForm.slabs,
                      { minKwh: last?.maxKwh ?? 0, maxKwh: null, ratePerKwh: (last?.ratePerKwh ?? 5) + 1 },
                    ],
                  });
                }}
              >
                <Plus />
                Add slab
              </Button>
            </div>
            <Button className="w-full" onClick={() => saveTariff.mutate()} loading={saveTariff.isPending}>
              Save tariff
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={applianceOpen} onOpenChange={setApplianceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add appliance</DialogTitle>
            <DialogDescription>
              Estimates use the rated power and hours you enter. They are never presented as measured consumption.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Name">
              <Input
                value={applianceForm.name}
                onChange={(e) => setApplianceForm({ ...applianceForm, name: e.target.value })}
                placeholder="Air conditioner"
              />
            </Field>
            <Field label="Category">
              <Select
                value={applianceForm.category}
                onChange={(e) => setApplianceForm({ ...applianceForm, category: e.target.value })}
              >
                {['Kitchen', 'Cooling', 'Heating', 'Lighting', 'Entertainment', 'Laundry', 'Other'].map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Rated power (W)">
                <Input
                  type="number"
                  value={applianceForm.ratedPowerW}
                  onChange={(e) => setApplianceForm({ ...applianceForm, ratedPowerW: e.target.value })}
                />
              </Field>
              <Field label="Hours per day">
                <Input
                  type="number"
                  step="0.5"
                  value={applianceForm.hours}
                  onChange={(e) => setApplianceForm({ ...applianceForm, hours: e.target.value })}
                />
              </Field>
            </div>
            <Button
              className="w-full"
              onClick={() => addAppliance.mutate()}
              loading={addAppliance.isPending}
              disabled={!applianceForm.name}
            >
              Add appliance
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
