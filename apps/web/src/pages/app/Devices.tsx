import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Copy,
  Cpu,
  KeyRound,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatPower } from '@wattnexa/shared';
import { InlineError, PageHeader, SimulatedBadge, StatusDot } from '@/components/common';
import {
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Skeleton,
  Table,
  Td,
  Th,
} from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/forms';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useHomes } from '@/lib/hooks';
import { useRealtime } from '@/lib/socket';
import { timeAgo } from '@/lib/utils';

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

export function Devices() {
  const { home, homeId } = useHomes();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [pairOpen, setPairOpen] = useState(false);
  const [pairing, setPairing] = useState<PairResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      await queryClient.invalidateQueries({ queryKey: ['devices'] });
      toast({ title: 'Device removed', description: 'Its credentials were revoked immediately.', variant: 'success' });
    },
  });

  const rotate = useMutation({
    mutationFn: (deviceId: string) => api.post<{ token: string }>(`/devices/${deviceId}/credentials`),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['device-detail'] });
      setPairing({
        device: { id: selectedId ?? '', name: detail.data?.name ?? 'Device', serial: detail.data?.serial ?? '', status: 'online' },
        deviceToken: result.token,
        telemetryTopic: '',
      });
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Devices"
        description={home ? `Hardware reporting into ${home.name}.` : 'Your connected hardware.'}
        actions={
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
        }
      />

      {devices.isError ? <InlineError message="Could not load devices." onRetry={() => void devices.refetch()} /> : null}
      {devices.isLoading ? <Skeleton className="h-48" /> : null}

      {devices.data && devices.data.length === 0 ? (
        <EmptyState
          icon={Cpu}
          title="No devices paired"
          description="Generate a pairing code, enter it on the device, and readings will appear here within seconds."
          action={
            <Button
              onClick={() => {
                setPairing(null);
                setPairOpen(true);
              }}
            >
              Pair your first device
            </Button>
          }
        />
      ) : null}

      {devices.data && devices.data.length > 0 ? (
        <Card className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Device</Th>
                <Th>Status</Th>
                <Th>Live</Th>
                <Th>Signal</Th>
                <Th>Last seen</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {devices.data.map((device) => (
                <tr
                  key={device.id}
                  className="cursor-pointer transition-colors hover:bg-muted/40"
                  onClick={() => openDetail(device)}
                >
                  <Td>
                    <p className="text-sm font-medium">{device.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{device.serial}</p>
                  </Td>
                  <Td>
                    <StatusDot status={device.status} />
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm">
                        {device.latestReading?.activePower != null
                          ? formatPower(device.latestReading.activePower)
                          : '—'}
                      </span>
                      {device.latestReading ? (
                        <SimulatedBadge simulated={device.latestReading.source === 'simulated'} />
                      ) : null}
                    </div>
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Wifi className="h-3 w-3" />
                      {device.signalStrength != null ? `${device.signalStrength} dBm` : '—'}
                    </span>
                  </Td>
                  <Td className="text-xs text-muted-foreground">
                    {device.lastSeenAt ? timeAgo(device.lastSeenAt) : 'never'}
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                      <Button variant="ghost" size="icon" title="Details" onClick={() => openDetail(device)}>
                        <Activity className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Remove device"
                        onClick={() => {
                          if (window.confirm(`Remove ${device.name}? Its credentials are revoked immediately.`)) {
                            remove.mutate(device.id);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Pairing                                                          */}
      {/* ---------------------------------------------------------------- */}
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
                ? 'Enter these details on the device, then power it on. This dialog will update when the first reading arrives.'
                : 'Clamp the CT sensor, power the ESP32, then enter the code shown on the device.'}
            </DialogDescription>
          </DialogHeader>

          {!pairing ? (
            <div className="space-y-4">
              <Field label="Pairing code" hint="Generate a fresh code, or use the one printed by the device.">
                <div className="flex gap-2">
                  <Input
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase())}
                    placeholder="WNX-XXXXXX"
                  />
                  <Button
                    variant="outline"
                    onClick={() => createPairingCode.mutate()}
                    loading={createPairingCode.isPending}
                  >
                    Generate
                  </Button>
                </div>
              </Field>
              <Field label="Serial number" hint="Printed on the label under the device. Optional.">
                <Input
                  value={serial}
                  onChange={(event) => setSerial(event.target.value.toUpperCase())}
                  placeholder="WNX-ESP32-A1B2C3"
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
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Device token</p>
                <code className="mt-1 block break-all font-mono text-[11px]">{pairing.deviceToken}</code>
                <Button
                  className="mt-2"
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
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">MQTT topic</p>
                  <code className="mt-1 block break-all font-mono text-[11px]">{pairing.telemetryTopic}</code>
                </div>
              ) : null}

              <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                {pairedDevice?.status === 'online' ? (
                  <Wifi className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Radio className="h-4 w-4 animate-pulse text-amber-500" />
                )}
                <div className="text-sm">
                  <p className="font-medium">
                    {pairedDevice?.status === 'online' ? 'Reading received' : 'Waiting for the first reading'}
                  </p>
                  <p className="text-xs text-muted-foreground">
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

      {/* ---------------------------------------------------------------- */}
      {/* Detail                                                           */}
      {/* ---------------------------------------------------------------- */}
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
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Live" value={detail.data.latestReading?.activePower != null ? formatPower(detail.data.latestReading.activePower) : '—'} />
                <Stat label="Voltage" value={detail.data.latestReading?.voltage != null ? `${detail.data.latestReading.voltage.toFixed(0)} V` : '—'} />
                <Stat label="Signal" value={detail.data.signalStrength != null ? `${detail.data.signalStrength} dBm` : '—'} />
                <Stat label="Last seen" value={detail.data.lastSeenAt ? timeAgo(detail.data.lastSeenAt) : 'never'} />
              </div>

              {detail.data.status === 'not_configured' ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
                  Paired, but no telemetry has arrived yet. Check that the device has the token, Wi-Fi credentials and the
                  correct MQTT topic.
                </p>
              ) : null}
              {detail.data.status === 'offline' ? (
                <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  <WifiOff className="h-3.5 w-3.5" />
                  Not reporting. The readings below are the last values received, not current consumption.
                </p>
              ) : null}

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sensors reported</h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {detail.data.sensors.map((sensor) => (
                    <Badge key={sensor.key} variant={sensor.available ? 'neutral' : 'outline'}>
                      {sensor.available ? null : <span className="mr-1 text-muted-foreground">—</span>}
                      {SENSOR_LABELS[sensor.key] ?? sensor.key}
                    </Badge>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Based on the last 20 readings. Unavailable sensors are shown, never filled with zero.
                </p>
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rename</h3>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <Input value={rename} onChange={(event) => setRename(event.target.value)} placeholder="Device name" />
                  <Input value={room} onChange={(event) => setRoom(event.target.value)} placeholder="Room (optional)" />
                  <Button
                    variant="outline"
                    onClick={() => selectedId && update.mutate(selectedId)}
                    loading={update.isPending}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Save
                  </Button>
                </div>
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connection history</h3>
                {detail.data.events.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">No events yet.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {detail.data.events.map((event) => (
                      <li key={event.id} className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 last:border-0">
                        <div>
                          <p className="text-xs font-medium">{EVENT_LABELS[event.type] ?? event.type}</p>
                          {event.message ? (
                            <p className="text-[11px] text-muted-foreground">{event.message}</p>
                          ) : null}
                        </div>
                        <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                          {timeAgo(event.occurredAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => selectedId && command.mutate(selectedId)} loading={command.isPending}>
                  <Radio className="h-3.5 w-3.5" />
                  Blink LED
                </Button>
                <Button variant="outline" size="sm" onClick={() => selectedId && rotate.mutate(selectedId)} loading={rotate.isPending}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  New token
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => {
                    if (selectedId && window.confirm('Remove this device? Its credentials are revoked immediately.')) {
                      remove.mutate(selectedId);
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove device
                </Button>
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Tokens ({detail.data.credentials.length})
                </h3>
                <ul className="mt-2 space-y-1">
                  {detail.data.credentials.map((credential) => (
                    <li key={credential.id} className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
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
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}
