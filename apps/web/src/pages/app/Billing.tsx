import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Receipt, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { formatCurrency } from '@wattnexa/shared';
import { InlineError, PageHeader } from '@/components/common';
import { Badge, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Skeleton, Table, Td, Th } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/forms';
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

const emptySlab = { minKwh: 0, maxKwh: 100, ratePerKwh: 5 };

export function Billing() {
  const { homeId, home } = useHomes();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tariffOpen, setTariffOpen] = useState(false);
  const [applianceOpen, setApplianceOpen] = useState(false);

  const estimate = useQuery({
    queryKey: ['estimate', homeId],
    queryFn: () => api.get<Estimate>(`/billing/estimate?homeId=${homeId}&range=this_month`),
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

  const [tariffForm, setTariffForm] = useState({
    name: 'My tariff',
    provider: '',
    fixedCharge: '100',
    taxPercent: '0',
    slabs: [emptySlab, { minKwh: 100, maxKwh: 300, ratePerKwh: 7 }, { minKwh: 300, maxKwh: null as number | null, ratePerKwh: 9 }],
  });
  const [applianceForm, setApplianceForm] = useState({ name: '', category: 'Kitchen', ratedPowerW: '100', hours: '2' });

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

  const activeTariff = tariffs.data?.find((tariff) => tariff.isActive) ?? tariffs.data?.[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description={home ? `Estimated costs for ${home.name}.` : 'Tariffs and estimates.'}
        actions={
          <Button onClick={() => setTariffOpen(true)}>
            <Plus />
            {activeTariff ? 'Replace tariff' : 'Add tariff'}
          </Button>
        }
      />

      {estimate.isError ? <InlineError message="Could not load the estimate." onRetry={() => void estimate.refetch()} /> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold">This month&apos;s estimate</p>
              <p className="text-xs text-muted-foreground">
                {estimate.data?.tariff ? `${estimate.data.tariff.name}${estimate.data.tariff.provider ? ` · ${estimate.data.tariff.provider}` : ''}` : 'No tariff configured'}
              </p>
            </div>
            <Badge variant="neutral">
              <Receipt className="h-3 w-3" /> Estimate
            </Badge>
          </div>

          {estimate.isLoading ? (
            <Skeleton className="mt-4 h-40" />
          ) : estimate.data ? (
            <div className="mt-4 space-y-3">
              <div className="flex items-end justify-between">
                <p className="text-3xl font-semibold tracking-tight">
                  {formatCurrency(estimate.data.total, estimate.data.currency)}
                </p>
                <p className="text-xs text-muted-foreground">{estimate.data.energyKwh.toFixed(2)} kWh</p>
              </div>
              <div className="space-y-1.5 text-xs">
                {estimate.data.slabs.map((slab) => (
                  <div key={slab.label} className="flex justify-between text-muted-foreground">
                    <span>
                      {slab.label} · {slab.kwh.toFixed(1)} kWh @ ₹{slab.ratePerKwh}
                    </span>
                    <span>{formatCurrency(slab.cost, estimate.data!.currency)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-1.5">
                  <span className="text-muted-foreground">Fixed charge</span>
                  <span>{formatCurrency(estimate.data.fixedCharge, estimate.data.currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax</span>
                  <span>{formatCurrency(estimate.data.taxAmount, estimate.data.currency)}</span>
                </div>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-xs">
                <p className="font-medium">
                  Projected month total: {formatCurrency(estimate.data.projection.projectedTotal, estimate.data.currency)}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  at {estimate.data.projection.projectedKwh.toFixed(0)} kWh · {estimate.data.disclaimer}
                </p>
              </div>
            </div>
          ) : null}
        </Card>

        <Card className="p-5">
          <p className="text-sm font-semibold">Active tariff</p>
          {tariffs.isLoading ? <Skeleton className="mt-3 h-24" /> : null}
          {activeTariff ? (
            <div className="mt-3 space-y-2 text-xs">
              <p className="font-medium">{activeTariff.name}</p>
              {activeTariff.slabs
                .slice()
                .sort((a, b) => a.minKwh - b.minKwh)
                .map((slab) => (
                  <div key={`${slab.minKwh}-${slab.maxKwh}`} className="flex justify-between text-muted-foreground">
                    <span>
                      {slab.minKwh}–{slab.maxKwh ?? '∞'} kWh
                    </span>
                    <span>₹{slab.ratePerKwh}/unit</span>
                  </div>
                ))}
              <div className="flex justify-between border-t border-border pt-2 text-muted-foreground">
                <span>Fixed</span>
                <span>₹{activeTariff.fixedCharge}</span>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Add your provider and slabs to turn kWh into rupees.
            </p>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Appliances</p>
            <p className="text-xs text-muted-foreground">
              Manual estimates from ratings and hours — not individually measured.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setApplianceOpen(true)}>
            <Plus />
            Add
          </Button>
        </div>

        {appliances.isLoading ? <Skeleton className="h-32" /> : null}
        {appliances.data && appliances.data.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <Th>Appliance</Th>
                <Th>Rated power</Th>
                <Th>Hours/day</Th>
                <Th>Est. kWh/month</Th>
                <Th>Est. cost</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {appliances.data.map((appliance) => (
                <tr key={appliance.id}>
                  <Td>
                    <p className="text-sm">{appliance.name}</p>
                    <p className="text-[11px] text-muted-foreground">{appliance.category}</p>
                  </Td>
                  <Td className="text-xs">{appliance.ratedPowerW} W</Td>
                  <Td className="text-xs">{appliance.estimatedHoursPerDay}</Td>
                  <Td className="text-xs">{appliance.estimatedMonthlyKwh.toFixed(1)}</Td>
                  <Td className="text-xs">
                    {appliance.estimatedMonthlyCost != null
                      ? formatCurrency(appliance.estimatedMonthlyCost, 'INR')
                      : '—'}
                  </Td>
                  <Td className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => removeAppliance.mutate(appliance.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          !appliances.isLoading && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No appliances yet. Add one to estimate its share of the bill.
            </p>
          )
        )}
      </Card>

      <Dialog open={tariffOpen} onOpenChange={setTariffOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure tariff</DialogTitle>
            <DialogDescription>
              Progressive slabs: each rate applies only to units inside its range.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
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
              <Field label="Tax (%)">
                <Input
                  type="number"
                  value={tariffForm.taxPercent}
                  onChange={(e) => setTariffForm({ ...tariffForm, taxPercent: e.target.value })}
                />
              </Field>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Slabs (kWh)</p>
              {tariffForm.slabs.map((slab, index) => (
                <div key={index} className="grid grid-cols-3 gap-2">
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
                </div>
              ))}
              <div className="flex gap-2">
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
                  Add slab
                </Button>
              </div>
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
            <DialogDescription>Estimates use the rated power and hours you enter.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Name">
              <Input value={applianceForm.name} onChange={(e) => setApplianceForm({ ...applianceForm, name: e.target.value })} placeholder="Air conditioner" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Rated power (W)">
                <Input type="number" value={applianceForm.ratedPowerW} onChange={(e) => setApplianceForm({ ...applianceForm, ratedPowerW: e.target.value })} />
              </Field>
              <Field label="Hours per day">
                <Input type="number" step="0.5" value={applianceForm.hours} onChange={(e) => setApplianceForm({ ...applianceForm, hours: e.target.value })} />
              </Field>
            </div>
            <Button className="w-full" onClick={() => addAppliance.mutate()} loading={addAppliance.isPending} disabled={!applianceForm.name}>
              Add appliance
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
