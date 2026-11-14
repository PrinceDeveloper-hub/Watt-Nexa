import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/common';
import { Badge, EmptyState, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Switch } from '@/components/ui/forms';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useHomes } from '@/lib/hooks';
import { formatDateTime } from '@/lib/utils';

interface Alert {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  createdAt: string;
  acknowledgedAt: string | null;
}

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

interface Preferences {
  emailEnabled: boolean;
  pushEnabled: boolean;
  powerThresholdW: number | null;
  temperatureThresholdC: number | null;
  dailyKwhThreshold: number | null;
  monthlyKwhThreshold: number | null;
  billThreshold: number | null;
}

const severityVariant = (severity: Alert['severity']) =>
  severity === 'critical' ? 'danger' : severity === 'warning' ? 'warning' : 'neutral';

export function Alerts() {
  const { homeId } = useHomes();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const alerts = useQuery({
    queryKey: ['alerts'],
    queryFn: () => api.get<Alert[]>('/alerts?limit=50'),
  });
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: NotificationItem[]; unread: number }>('/alerts/notifications'),
  });
  const preferences = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => api.get<Preferences>('/alerts/preferences'),
  });

  const [form, setForm] = useState<Record<string, string>>({});
  const prefs = preferences.data;
  const value = (key: keyof Preferences) =>
    form[key] ?? (prefs?.[key] == null ? '' : String(prefs[key]));

  const savePrefs = useMutation({
    mutationFn: () =>
      api.put('/alerts/preferences', {
        powerW: value('powerThresholdW') === '' ? null : Number(value('powerThresholdW')),
        temperatureC: value('temperatureThresholdC') === '' ? null : Number(value('temperatureThresholdC')),
        dailyKwh: value('dailyKwhThreshold') === '' ? null : Number(value('dailyKwhThreshold')),
        monthlyKwh: value('monthlyKwhThreshold') === '' ? null : Number(value('monthlyKwhThreshold')),
        billAmount: value('billThreshold') === '' ? null : Number(value('billThreshold')),
        emailEnabled: prefs?.emailEnabled ?? true,
        pushEnabled: prefs?.pushEnabled ?? false,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
      toast({ title: 'Alert thresholds saved', variant: 'success' });
    },
    onError: (error) => toast({ title: 'Could not save', description: error.message, variant: 'error' }),
  });

  const markAll = useMutation({
    mutationFn: () => api.post('/alerts/notifications/read-all'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) => api.post(`/alerts/${id}/acknowledge`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts & notifications"
        description="Thresholds you control, deduplicated so a single spike does not spam you."
        actions={
          <Button variant="outline" size="sm" onClick={() => markAll.mutate()} loading={markAll.isPending}>
            <CheckCheck />
            Mark all read
          </Button>
        }
      />

      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="notifications">
            Notifications {notifications.data?.unread ? `(${notifications.data.unread})` : ''}
          </TabsTrigger>
          <TabsTrigger value="settings">Thresholds</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts" className="mt-4 space-y-2">
          {alerts.isLoading ? <Skeleton className="h-32" /> : null}
          {alerts.data?.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No alerts yet"
              description="When consumption crosses a threshold you set, or a device goes offline, it appears here."
            />
          ) : null}
          {(alerts.data ?? []).map((alert) => (
            <Card key={alert.id} className="flex items-start justify-between gap-4 p-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={severityVariant(alert.severity)}>{alert.severity}</Badge>
                  <p className="text-sm font-medium">{alert.title}</p>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{alert.message}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{formatDateTime(alert.createdAt)}</p>
              </div>
              {!alert.acknowledgedAt ? (
                <Button variant="ghost" size="sm" onClick={() => acknowledge.mutate(alert.id)}>
                  Acknowledge
                </Button>
              ) : (
                <Badge variant="neutral">Acknowledged</Badge>
              )}
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="notifications" className="mt-4 space-y-2">
          {notifications.isLoading ? <Skeleton className="h-32" /> : null}
          {notifications.data?.items.length === 0 ? (
            <EmptyState icon={BellRing} title="Nothing new" description="Notifications from alerts and your account appear here." />
          ) : null}
          {(notifications.data?.items ?? []).map((item) => (
            <Card key={item.id} className="p-4">
              <div className="flex items-center gap-2">
                {!item.readAt ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
                <p className="text-sm font-medium">{item.title}</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{item.body}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{formatDateTime(item.createdAt)}</p>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <Card className="max-w-2xl p-5">
            <p className="text-sm font-semibold">Alert thresholds</p>
            <p className="mb-4 text-xs text-muted-foreground">Leave a field empty to disable that alert.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Power above (W)">
                <Input type="number" value={value('powerThresholdW')} onChange={(e) => setForm({ ...form, powerThresholdW: e.target.value })} placeholder="2000" />
              </Field>
              <Field label="Temperature above (°C)">
                <Input type="number" value={value('temperatureThresholdC')} onChange={(e) => setForm({ ...form, temperatureThresholdC: e.target.value })} placeholder="45" />
              </Field>
              <Field label="Daily usage above (kWh)">
                <Input type="number" value={value('dailyKwhThreshold')} onChange={(e) => setForm({ ...form, dailyKwhThreshold: e.target.value })} placeholder="12" />
              </Field>
              <Field label="Monthly usage above (kWh)">
                <Input type="number" value={value('monthlyKwhThreshold')} onChange={(e) => setForm({ ...form, monthlyKwhThreshold: e.target.value })} placeholder="300" />
              </Field>
              <Field label="Estimated bill above (₹)">
                <Input type="number" value={value('billThreshold')} onChange={(e) => setForm({ ...form, billThreshold: e.target.value })} placeholder="2500" />
              </Field>
            </div>
            <div className="mt-4 flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-xs font-medium">Email notifications</p>
                <p className="text-[11px] text-muted-foreground">
                  Sends through the configured SMTP server. Without SMTP, email is captured in the dev outbox.
                </p>
              </div>
              <Switch
                checked={prefs?.emailEnabled ?? true}
                onCheckedChange={(checked) =>
                  queryClient.setQueryData<Preferences>(['notification-preferences'], (current) => ({
                    ...(current ?? ({} as Preferences)),
                    emailEnabled: checked,
                  }))
                }
              />
            </div>
            <Button className="mt-4" onClick={() => savePrefs.mutate()} loading={savePrefs.isPending} disabled={!homeId}>
              Save thresholds
            </Button>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
