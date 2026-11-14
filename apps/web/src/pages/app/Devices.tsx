import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { Copy, Cpu, KeyRound, Plus, RefreshCw, Trash2, Wifi } from 'lucide-react';
import { useState } from 'react';
import { formatPower } from '@wattnexa/shared';
import { InlineError, PageHeader, SimulatedBadge, StatusDot } from '@/components/common';
import { Badge, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, EmptyState, Skeleton, Table, Td, Th } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/forms';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useHomes } from '@/lib/hooks';
import { timeAgo } from '@/lib/utils';

interface DeviceRow {
  id: string;
  name: string;
  serial: string;
  model: string;
  status: string;
  firmwareVersion: string | null;
  lastSeenAt: string | null;
  signalStrength: number | null;
  room: string | null;
  latestReading: { activePower: number | null; source: string } | null;
}

export function Devices() {
  const { home, homeId } = useHomes();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pairOpen, setPairOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const devices = useQuery({
    queryKey: ['devices', homeId],
    queryFn: () => api.get<DeviceRow[]>(`/devices?homeId=${homeId}`),
    enabled: Boolean(homeId),
  });

  const pair = useMutation({
    mutationFn: () => api.post<{ deviceToken: string }>('/devices/pair', { code, homeId, name: name || undefined }),
    onSuccess: async (result) => {
      setIssuedToken(result.deviceToken);
      setPairOpen(false);
      setCode('');
      setName('');
      await queryClient.invalidateQueries({ queryKey: ['devices'] });
      toast({ title: 'Device paired', description: 'Store the device token now — it is shown once.', variant: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Pairing failed', description: error instanceof Error ? error.message : undefined, variant: 'error' }),
  });

  const createPairingCode = useMutation({
    mutationFn: () => api.post<{ code: string }>('/devices/pairing', { homeId }),
    onSuccess: (result) => setCode(result.code),
  });

  const remove = useMutation({
    mutationFn: (deviceId: string) => api.del(`/devices/${deviceId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['devices'] });
      toast({ title: 'Device removed', variant: 'success' });
    },
  });

  const rotate = useMutation({
    mutationFn: (deviceId: string) => api.post<{ token: string }>(`/devices/${deviceId}/credentials`),
    onSuccess: (result) => setIssuedToken(result.token),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Devices"
        description={home ? `Hardware reporting into ${home.name}.` : 'Your connected hardware.'}
        actions={
          <Button onClick={() => setPairOpen(true)} disabled={!homeId}>
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
          action={<Button onClick={() => setPairOpen(true)}>Pair your first device</Button>}
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
                <Th>Firmware</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {devices.data.map((device) => (
                <tr key={device.id}>
                  <Td>
                    <p className="text-sm font-medium">{device.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{device.serial}</p>
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <StatusDot status={device.status} />
                      <span className="text-[11px] text-muted-foreground">
                        {device.lastSeenAt ? timeAgo(device.lastSeenAt) : 'never'}
                      </span>
                    </div>
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
                  <Td className="text-xs text-muted-foreground">{device.firmwareVersion ?? '—'}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Rotate credential"
                        onClick={() => rotate.mutate(device.id)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
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

      <Dialog open={pairOpen} onOpenChange={setPairOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pair a device</DialogTitle>
            <DialogDescription>
              Clamp the sensor, power the ESP32, then enter the pairing code shown on the device.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field
              label="Pairing code"
              hint="Demo code from the seed: WNX-PAIR-4F2A"
            >
              <div className="flex gap-2">
                <Input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="WNX-XXXXXX" />
                <Button variant="outline" onClick={() => createPairingCode.mutate()} loading={createPairingCode.isPending}>
                  Generate
                </Button>
              </div>
            </Field>
            <Field label="Device name" hint="Optional — you can rename it later.">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Main meter" />
            </Field>
            <Button className="w-full" onClick={() => pair.mutate()} loading={pair.isPending} disabled={code.length < 4}>
              Complete pairing
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(issuedToken)} onOpenChange={() => setIssuedToken(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              Device token
            </DialogTitle>
            <DialogDescription>
              Copy this now. Only a hash is stored, so it cannot be shown again. Use it as
              <code className="mx-1 rounded bg-muted px-1">Authorization: Bearer &lt;token&gt;</code>
              when posting telemetry.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <code className="block break-all font-mono text-[11px]">{issuedToken}</code>
          </div>
          <Button
            className="mt-3 w-full"
            variant="outline"
            onClick={() => {
              if (issuedToken) void navigator.clipboard.writeText(issuedToken);
              toast({ title: 'Copied to clipboard', variant: 'success' });
            }}
          >
            <Copy />
            Copy token
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
