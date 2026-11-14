import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Check,
  Copy,
  Cpu,
  KeyRound,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Trash2,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatPower } from '@wattnexa/shared';
import { InlineError, PageHeader, Segmented, SimulatedBadge, StatusDot } from '@/components/common';
import { Pagination } from '@/components/pagination';
import {
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Skeleton,
} from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/forms';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useHomes } from '@/lib/hooks';
import { useRealtime } from '@/lib/socket';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';

interface Reading {
  activePower: number | null;
  voltage: number | null;
  current: number | null;
  temperature: number | null;
  source: string;
  recordedAt: string;
}

interface DeviceRow {
  id: string;
  name: string;
  serial: string;
  model: string;
  status: string;
  firmwareVersion: string | null;
  lastSeenAt: string | null;
  lastReadingAt: string | null;
  signalStrength: number | null;
  room: string | null;
  latestReading: Reading | null;
}

interface DeviceEventRow {
  id: number;
  type: string;
  message: string | null;
  occurredAt: string;
  metadata: Record<string, unknown> | null;
}

interface SensorCapability {
  key: string;
  available: boolean;
}

interface DeviceDetail extends DeviceRow {
  sensors: SensorCapability[];
  events: DeviceEventRow[];
  credentials: Array<{ id: string; label: string; lastUsedAt: string | null; revokedAt: string | null }>;
}

interface PairResult {
  device: { id: string; name: string; serial: string; status: string };
  deviceToken: string;
  telemetryTopic: string;
}

const SENSOR_LABELS: Record<string, string> = {
  voltage: 'Voltage',
  current: 'Current',
  activePower: 'Active power',
  apparentPower: 'Apparent power',
  powerFactor: 'Power factor',
  energyKwh: 'Energy meter',
  temperature: 'Temperature',
  frequency: 'Frequency',
  signalStrength: 'Wi-Fi signal',
};

const EVENT_LABELS: Record<string, string> = {
  paired: 'Paired',
  connected: 'Connected',
  reconnected: 'Reconnected',
  disconnected: 'Disconnected',
  error: 'Error',
  credential_issued: 'Credential issued',
  credential_revoked: 'Credential revoked',
  telemetry_rejected: 'Telemetry rejected',
  status_changed: 'Status changed',
};

function SignalBars({ value }: { value: number | null }) {
  const level = value == null ? 0 : value >= -55 ? 4 : value >= -65 ? 3 : value >= -75 ? 2 : 1;
  return (
    <span className="inline-flex items-end gap-0.5" title={value != null ? `${value} dBm` : 'Signal unavailable'}>
      {[1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          className={cn(
            'w-1 rounded-sm',
            bar === 1 && 'h-1.5',
            bar === 2 && 'h-2.5',
            bar === 3 && 'h-3.5',
            bar === 4 && 'h-4',
            level >= bar ? 'bg-primary' : 'bg-border',
          )}
        />
      ))}
      <span className="ml-1 text-[10px] text-muted-foreground">{value != null ? `${value} dBm` : '—'}</span>
    </span>
  );
}

export function Devices() {
  const { home, homeId } = useHomes();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [pairOpen, setPairOpen] = useState(false);
  const [pairing, setPairing] = useState<PairResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<DeviceRow | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'attention'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [searchParams] = useSearchParams();
  const focusedDeviceId = searchParams.get('deviceId');

  // Notification actions deep-link to a specific device; the id is still
  // resolved server-side by requireDeviceAccess before its details render.
  useEffect(() => {
    if (focusedDeviceId) setSelectedId(focusedDeviceId);
  }, [focusedDeviceId]);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [serial, setSerial] = useState('');
  const [rename, setRename] = useState('');
  const [room, setRoom] = useState('');

  const devices = useQuery({
    queryKey: ['devices', homeId],
    queryFn: () => api.get<DeviceRow[]>(`/devices?homeId=${homeId}`),
    enabled: Boolean(homeId),
    refetchInterval: 20_000,
  });

  useRealtime({
    'telemetry:new': () => {
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      void queryClient.invalidateQueries({ queryKey: ['device-detail'] });
    },
    'device:status': () => {
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      void queryClient.invalidateQueries({ queryKey: ['device-detail'] });
    },
  });

  const detail = useQuery({
    queryKey: ['device-detail', selectedId],
    queryFn: () => api.get<DeviceDetail>(`/devices/${selectedId}`),
    enabled: Boolean(selectedId),
    refetchInterval: selectedId ? 10_000 : false,
  });

  // Polls until the first reading arrives: pairing alone never marks a device online.
  const pairingStatus = useQuery({
    queryKey: ['pairing-status', pairing?.device.id],
    queryFn: () =>
      api.get<{ status: string; lastSeenAt: string | null }>(`/telemetry/${pairing?.device.id}/latest`),
    enabled: Boolean(pairing),
    refetchInterval: pairing ? 3_000 : false,
  });

  const pair = useMutation({
    mutationFn: () =>
      api.post<PairResult>('/devices/pair', {
        code,
        homeId,
        name: name || undefined,
        serial: serial || undefined,
      }),
    onSuccess: async (result) => {
      setPairing(result);
      setCode('');
      setName('');
      setSerial('');
      await queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (error) =>
      toast({
        title: 'Pairing failed',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      }),
  });

  const createPairingCode = useMutation({
    mutationFn: () => api.post<{ code: string }>('/devices/pairing', { homeId }),
    onSuccess: (result) => setCode(result.code),
    onError: (error) =>
      toast({
        title: 'Could not create a code',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      }),
  });

  const update = useMutation({
    mutationFn: (deviceId: string) =>
      api.patch(`/devices/${deviceId}`, { name: rename || undefined, room: room || null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['devices'] });
      await queryClient.invalidateQueries({ queryKey: ['device-detail'] });
      toast({ title: 'Device updated', variant: 'success' });
    },
  });

  const remove = useMutation({
    mutationFn: (deviceId: string) => api.del(`/devices/${deviceId}`),
    onSuccess: async () => {
      setSelectedId(null);
      setRemoveTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['devices'] });
      toast({ title: 'Device removed', description: 'Its credentials were revoked immediately.', variant: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Could not remove device', description: error.message, variant: 'error' }),
  });

  const rotate = useMutation({
    mutationFn: (deviceId: string) => api.post<{ token: string }>(`/devices/${deviceId}/credentials`),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['device-detail'] });
      setPairing({
        device: {
          id: selectedId ?? '',
          name: detail.data?.name ?? 'Device',
          serial: detail.data?.serial ?? '',
          status: 'online',
        },
        deviceToken: result.token,
        telemetryTopic: '',
      });
      setSelectedId(null);
      setPairOpen(true);
      toast({ title: 'New token issued', description: 'Store it now — it is shown once.', variant: 'success' });
    },
  });

  const command = useMutation({
    mutationFn: (deviceId: string) => api.post(`/devices/${deviceId}/commands`, { command: 'identify' }),
    onSuccess: () => toast({ title: 'Command sent', description: 'The device should blink for 10 seconds.', variant: 'success' }),
    onError: (error) =>
      toast({
        title: 'Command not delivered',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      }),
  });

  const openDetail = (device: DeviceDetail | DeviceRow) => {
    setSelectedId(device.id);
    setRename(device.name);
    setRoom(device.room ?? '');
  };

  const pairedDevice = pairing ? pairingStatus.data : undefined;
  const rows = devices.data ?? [];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredRows = rows.filter((device) => {
    const matchesQuery =
      !normalizedQuery ||
      [device.name, device.serial, device.model, device.room ?? '']
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    const matchesStatus =
      statusFilter === 'all' || (statusFilter === 'online' ? device.status === 'online' : device.status !== 'online');
    return matchesQuery && matchesStatus;
  });
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const online = rows.filter((device) => device.status === 'online').length;
  const attention = rows.filter((device) => ['offline', 'error', 'not_configured'].includes(device.status)).length;
  const liveDraw = rows.reduce((sum, device) => sum + (device.latestReading?.activePower ?? 0), 0);
  const anySimulated = rows.some((device) => device.latestReading?.source === 'simulated');

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, pageSize, homeId]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Fleet"
        title="Devices"
        description={home ? `Hardware reporting into ${home.name}.` : 'Your connected hardware.'}
        actions={
          <>
            {rows.length ? <SimulatedBadge simulated={anySimulated} /> : null}
            <Button
              onClick={() => {
                setPairing(null);
                setPairOpen(true);
              }}
              disabled={!homeId}
            >
              <Plus />
              Add device
            </Button>
          </>
        }
      />

      {devices.isError ? <InlineError message="Could not load devices." onRetry={() => void devices.refetch()} /> : null}

      {devices.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-52" />
          <Skeleton className="h-52" />
          <Skeleton className="h-52" />
        </div>
      ) : null}

      {devices.data && devices.data.length === 0 ? (
        <EmptyState
          className="py-16"
          icon={Cpu}
          title="No devices paired"
          description="Generate a pairing code, enter it on the device, and real readings will appear here within seconds. Pairing alone never marks a device online."
          action={
            <Button
              onClick={() => {
                setPairing(null);
                setPairOpen(true);
              }}
            >
              <Plus />
              Pair your first device
            </Button>
          }
        />
      ) : null}

      {rows.length > 0 ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Paired devices', value: String(rows.length), hint: 'This household', icon: Cpu },
              { label: 'Online now', value: String(online), hint: 'Reporting real traffic', icon: Wifi },
              {
                label: 'Needs attention',
                value: String(attention),
                hint: attention ? 'Offline, error or not configured' : 'All statuses healthy',
                icon: AlertTriangle,
              },
              {
                label: 'Current draw',
                value: formatPower(liveDraw),
                hint: 'Sum of latest samples',
                icon: Zap,
              },
            ].map((tile) => (
              <div key={tile.label} className="panel flex items-center gap-4 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/40 text-primary">
                  <tile.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="eyebrow">{tile.label}</p>
                  <p className="metric mt-0.5 text-xl font-semibold">{tile.value}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{tile.hint}</p>
                </div>
              </div>
            ))}
          </section>

          <div className="panel flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, serial, model or room"
                aria-label="Search devices"
                className="h-9 pl-9"
              />
            </div>
            <Segmented
              ariaLabel="Filter devices by status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'all', label: `All ${rows.length}` },
                { value: 'online', label: `Online ${online}` },
                { value: 'attention', label: `Attention ${attention}` },
              ]}
            />
          </div>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pagedRows.map((device) => (
              <article
                key={device.id}
                className="panel group relative flex flex-col overflow-hidden p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lift"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/40">
                      <Cpu className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-sm font-semibold">{device.name}</h3>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {device.room ? `${device.room} · ` : ''}
                        {device.serial}
                      </p>
                    </div>
                  </div>
                  <StatusDot status={device.status} />
                </div>

                <div className="mt-5 flex items-end justify-between gap-3">
                  <div>
                    <p className="eyebrow">Live power</p>
                    <p className="metric mt-1 text-[26px] font-semibold leading-none">
                      {device.latestReading?.activePower != null
                        ? formatPower(device.latestReading.activePower)
                        : '—'}
                    </p>
                  </div>
                  <div className="text-right text-[10px] text-muted-foreground">
                    {device.latestReading ? (
                      <>
                        <p>{device.latestReading.voltage != null ? `${device.latestReading.voltage.toFixed(0)} V` : 'V unknown'}</p>
                        <p>{device.latestReading.current != null ? `${device.latestReading.current.toFixed(2)} A` : 'A unknown'}</p>
                      </>
                    ) : (
                      <p>Awaiting first sample</p>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/70 pt-3 text-[10px] text-muted-foreground">
                  <SignalBars value={device.signalStrength} />
                  <span className="inline-flex items-center gap-1">
                    <Activity className="h-3 w-3" />
                    {device.lastSeenAt ? timeAgo(device.lastSeenAt) : 'never seen'}
                  </span>
                  {device.latestReading ? (
                    <SimulatedBadge simulated={device.latestReading.source === 'simulated'} />
                  ) : (
                    <Badge variant="outline">No reading</Badge>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <Button variant="outline" size="sm" onClick={() => openDetail(device)} className="flex-1">
                    Details
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${device.name}`}
                    onClick={() => setRemoveTarget(device)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </article>
            ))}
          </section>

          {filteredRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center">
              <p className="text-xs font-medium">No devices match this filter</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Clear the search or switch the status filter.</p>
            </div>
          ) : null}

          {filteredRows.length > 0 ? (
            <div className="panel px-4 py-3">
              <Pagination
                page={safePage}
                pageSize={pageSize}
                total={filteredRows.length}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                pageSizeOptions={[6, 12, 24]}
                itemLabel="devices"
                className="border-t-0 pt-0"
              />
            </div>
          ) : null}

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Status is written only from real telemetry. A device marked <span className="font-medium">Not configured</span>{' '}
            is paired but has not reported yet; <span className="font-medium">Offline</span> means the offline sweep saw no
            traffic inside the configured silence window.
          </p>
        </>
      ) : null}

      {/* Pairing */}
      <Dialog
        open={pairOpen}
        onOpenChange={(open) => {
          setPairOpen(open);
          if (!open) setPairing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pairing ? 'Finish setting up' : 'Pair a device'}</DialogTitle>
            <DialogDescription>
              {pairing
                ? 'Enter these details on the device, then power it on. This dialog updates when the first reading arrives.'
                : 'Clamp the CT sensor, power the ESP32, then enter the code shown on the device.'}
            </DialogDescription>
          </DialogHeader>

          <div className="mb-5 flex items-center gap-2">
            {[
              { step: 1, label: 'Pair' },
              { step: 2, label: 'Credentials' },
              { step: 3, label: 'First reading' },
            ].map((item, index) => {
              const active = pairing ? (pairedDevice?.status === 'online' ? 3 : 2) : 1;
              return (
                <div key={item.step} className="flex flex-1 items-center gap-2">
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
                      active >= item.step
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-muted/40 text-muted-foreground',
                    )}
                  >
                    {active > item.step ? <Check className="h-3 w-3" /> : item.step}
                  </span>
                  <span className={cn('text-[10px]', active >= item.step ? 'text-foreground' : 'text-muted-foreground')}>
                    {item.label}
                  </span>
                  {index < 2 ? <span className="h-px flex-1 bg-border" /> : null}
                </div>
              );
            })}
          </div>

          {!pairing ? (
            <div className="space-y-4">
              <Field label="Pairing code" hint="Generate a fresh code, or use the one printed by the device.">
                <div className="flex gap-2">
                  <Input
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase())}
                    placeholder="WNX-XXXXXX"
                    className="font-mono"
                  />
                  <Button variant="outline" onClick={() => createPairingCode.mutate()} loading={createPairingCode.isPending}>
                    Generate
                  </Button>
                </div>
              </Field>
              <Field label="Serial number" hint="Printed on the label under the device. Optional.">
                <Input
                  value={serial}
                  onChange={(event) => setSerial(event.target.value.toUpperCase())}
                  placeholder="WNX-ESP32-A1B2C3"
                  className="font-mono"
                />
              </Field>
              <Field label="Device name" hint="Optional — you can rename it later.">
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Main meter" />
              </Field>
              <Button
                className="w-full"
                onClick={() => pair.mutate()}
                loading={pair.isPending}
                disabled={code.length < 4}
              >
                Complete pairing
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-3.5">
                <p className="eyebrow text-primary">Device token · shown once</p>
                <code className="mt-1.5 block break-all font-mono text-[11px] leading-relaxed">{pairing.deviceToken}</code>
                <Button
                  className="mt-2.5"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(pairing.deviceToken);
                    toast({ title: 'Copied to clipboard', variant: 'success' });
                  }}
                >
                  <Copy className="h-3 w-3" />
                  Copy token
                </Button>
              </div>

              {pairing.telemetryTopic ? (
                <div className="rounded-xl border border-border p-3.5">
                  <p className="eyebrow">MQTT topic</p>
                  <code className="mt-1.5 block break-all font-mono text-[11px]">{pairing.telemetryTopic}</code>
                </div>
              ) : null}

              <div className="flex items-start gap-3 rounded-xl border border-border p-3.5">
                {pairedDevice?.status === 'online' ? (
                  <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <Radio className="mt-0.5 h-4 w-4 shrink-0 animate-pulse text-warning" />
                )}
                <div className="text-sm">
                  <p className="text-xs font-semibold">
                    {pairedDevice?.status === 'online' ? 'Reading received' : 'Waiting for the first reading'}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {pairedDevice?.status === 'online'
                      ? 'The device is connected and reporting.'
                      : 'The device is paired but not reporting yet. Nothing is marked online until data arrives.'}
                  </p>
                </div>
              </div>

              <Button
                className="w-full"
                variant="outline"
                onClick={() => {
                  setPairOpen(false);
                  setPairing(null);
                }}
              >
                Done
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Device detail */}
      <Dialog open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-w-2xl">
          {detail.isLoading ? <Skeleton className="h-64" /> : null}
          {detail.data ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {detail.data.name}
                  <StatusDot status={detail.data.status} />
                </DialogTitle>
                <DialogDescription className="font-mono text-[11px]">
                  {detail.data.serial} · {detail.data.model}
                  {detail.data.firmwareVersion ? ` · firmware ${detail.data.firmwareVersion}` : ''}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {[
                  {
                    label: 'Live',
                    value:
                      detail.data.latestReading?.activePower != null
                        ? formatPower(detail.data.latestReading.activePower)
                        : '—',
                  },
                  {
                    label: 'Voltage',
                    value:
                      detail.data.latestReading?.voltage != null
                        ? `${detail.data.latestReading.voltage.toFixed(0)} V`
                        : '—',
                  },
                  { label: 'Signal', value: detail.data.signalStrength != null ? `${detail.data.signalStrength} dBm` : '—' },
                  { label: 'Last seen', value: detail.data.lastSeenAt ? timeAgo(detail.data.lastSeenAt) : 'never' },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border border-border/70 bg-muted/30 p-3">
                    <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{stat.label}</p>
                    <p className="metric mt-0.5 text-sm font-semibold">{stat.value}</p>
                  </div>
                ))}
              </div>

              {detail.data.status === 'not_configured' ? (
                <p className="mt-3 flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/[0.06] p-3 text-[11px] leading-relaxed text-warning">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Paired, but no telemetry has arrived yet. Check that the device has the token, Wi-Fi credentials and the
                  correct MQTT topic.
                </p>
              ) : null}
              {detail.data.status === 'offline' ? (
                <p className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
                  <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Not reporting. The readings below are the last values received, not current consumption.
                </p>
              ) : null}

              <section className="mt-5">
                <h3 className="eyebrow">Sensors reported</h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {detail.data.sensors.map((sensor) => (
                    <Badge key={sensor.key} variant={sensor.available ? 'neutral' : 'outline'}>
                      {sensor.available ? (
                        <Check className="h-3 w-3 text-primary" />
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                      {SENSOR_LABELS[sensor.key] ?? sensor.key}
                    </Badge>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Based on the last 20 readings. Unavailable sensors are shown, never filled with zero.
                </p>
              </section>

              <section className="mt-5">
                <h3 className="eyebrow">Rename</h3>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <Input value={rename} onChange={(event) => setRename(event.target.value)} placeholder="Device name" />
                  <Input value={room} onChange={(event) => setRoom(event.target.value)} placeholder="Room (optional)" />
                  <Button variant="outline" onClick={() => selectedId && update.mutate(selectedId)} loading={update.isPending}>
                    <Pencil className="h-3.5 w-3.5" />
                    Save
                  </Button>
                </div>
              </section>

              <section className="mt-5">
                <h3 className="eyebrow">Connection history</h3>
                {detail.data.events.length === 0 ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">No events yet.</p>
                ) : (
                  <ol className="mt-3 space-y-0">
                    {detail.data.events.slice(0, 8).map((event, index) => (
                      <li key={event.id} className="relative flex gap-3 pb-3 last:pb-0">
                        <span className="relative flex flex-col items-center">
                          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary/70" />
                          {index < Math.min(detail.data!.events.length, 8) - 1 ? (
                            <span className="mt-1 w-px flex-1 bg-border" />
                          ) : null}
                        </span>
                        <div className="min-w-0 flex-1 pb-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-[11px] font-medium">{EVENT_LABELS[event.type] ?? event.type}</p>
                            <span className="text-[10px] text-muted-foreground">
                              {formatDateTime(event.occurredAt)}
                            </span>
                          </div>
                          {event.message ? (
                            <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{event.message}</p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section className="mt-5">
                <h3 className="eyebrow">Tokens ({detail.data.credentials.length})</h3>
                <ul className="mt-2 space-y-1.5">
                  {detail.data.credentials.map((credential) => (
                    <li
                      key={credential.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-2.5 py-1.5 text-[10px] text-muted-foreground"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <KeyRound className="h-3 w-3" />
                        {credential.label}
                      </span>
                      <span>
                        {credential.revokedAt
                          ? 'revoked'
                          : credential.lastUsedAt
                            ? `used ${timeAgo(credential.lastUsedAt)}`
                            : 'never used'}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="mt-5 flex flex-wrap gap-2 border-t border-border/70 pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectedId && command.mutate(selectedId)}
                  loading={command.isPending}
                >
                  <Radio className="h-3.5 w-3.5" />
                  Blink LED
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectedId && rotate.mutate(selectedId)}
                  loading={rotate.isPending}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  New token
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    if (detail.data) setRemoveTarget(detail.data);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove device
                </Button>
              </section>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <Dialog open={Boolean(removeTarget)} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {removeTarget?.name}?</DialogTitle>
            <DialogDescription>
              This revokes its credentials immediately and stops telemetry ingest. Historical readings stay in your
              account. This cannot be undone from the app without re-pairing the device.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
            <p className="font-medium text-foreground">{removeTarget?.serial}</p>
            <p className="mt-0.5">
              {removeTarget?.lastSeenAt ? `Last seen ${timeAgo(removeTarget.lastSeenAt)}` : 'Never reported'}
            </p>
          </div>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              Keep device
            </Button>
            <Button
              variant="destructive"
              loading={remove.isPending}
              onClick={() => removeTarget && remove.mutate(removeTarget.id)}
            >
              <Trash2 />
              Remove device
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
