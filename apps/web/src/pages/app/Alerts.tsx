import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  Info,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { InlineError, PageHeader, Segmented } from '@/components/common';
import { Pagination } from '@/components/pagination';
import {
  Badge,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Field, Input, Switch } from '@/components/ui/forms';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useHomes } from '@/lib/hooks';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';

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

type SeverityFilter = 'all' | 'critical' | 'warning' | 'info';

const severityMeta = {
  critical: {
    icon: ShieldAlert,
    label: 'Critical',
    rail: 'bg-destructive',
    chip: 'border-destructive/20 bg-destructive/[0.06] text-destructive',
    iconBg: 'bg-destructive/10 text-destructive',
  },
  warning: {
    icon: AlertTriangle,
    label: 'Warning',
    rail: 'bg-warning',
    chip: 'border-warning/20 bg-warning/[0.06] text-warning',
    iconBg: 'bg-warning/10 text-warning',
  },
  info: {
    icon: Info,
    label: 'Info',
    rail: 'bg-chart-3',
    chip: 'border-chart-3/25 bg-chart-3/10 text-chart-3',
    iconBg: 'bg-chart-3/10 text-chart-3',
  },
} as const;

export function Alerts() {
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('view');
  const [activeTab, setActiveTab] = useState<'alerts' | 'notifications' | 'settings'>(
    requestedTab === 'settings' ? 'settings' : 'alerts',
  );
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [alertPage, setAlertPage] = useState(1);
  const [alertPageSize, setAlertPageSize] = useState(8);
  const [notificationPage, setNotificationPage] = useState(1);
  const [notificationPageSize, setNotificationPageSize] = useState(10);
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
  const value = (key: keyof Preferences) => (form[key] ?? (prefs?.[key] == null ? '' : String(prefs[key])));

  useEffect(() => {
    if (requestedTab === 'settings') setActiveTab('settings');
  }, [requestedTab]);

  useEffect(() => {
    setAlertPage(1);
  }, [severity, alertPageSize]);

  useEffect(() => {
    setNotificationPage(1);
  }, [notificationPageSize]);

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
    onError: (error) => toast({ title: 'Could not update notifications', description: error.message, variant: 'error' }),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => api.post(`/alerts/notifications/${id}/read`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (error) => toast({ title: 'Could not update notification', description: error.message, variant: 'error' }),
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) => api.post(`/alerts/${id}/acknowledge`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['alerts'] }),
    onError: (error) => toast({ title: 'Could not acknowledge', description: error.message, variant: 'error' }),
  });

  const counts = useMemo(() => {
    const rows = alerts.data ?? [];
    return {
      all: rows.length,
      critical: rows.filter((alert) => alert.severity === 'critical').length,
      warning: rows.filter((alert) => alert.severity === 'warning').length,
      info: rows.filter((alert) => alert.severity === 'info').length,
      open: rows.filter((alert) => !alert.acknowledgedAt).length,
    };
  }, [alerts.data]);

  const visibleAlerts = (alerts.data ?? []).filter(
    (alert) => severity === 'all' || alert.severity === severity,
  );
  const alertTotalPages = Math.max(1, Math.ceil(visibleAlerts.length / alertPageSize));
  const safeAlertPage = Math.min(alertPage, alertTotalPages);
  const pagedAlerts = visibleAlerts.slice(
    (safeAlertPage - 1) * alertPageSize,
    safeAlertPage * alertPageSize,
  );

  const notificationItems = notifications.data?.items ?? [];
  const notificationTotalPages = Math.max(1, Math.ceil(notificationItems.length / notificationPageSize));
  const safeNotificationPage = Math.min(notificationPage, notificationTotalPages);
  const pagedNotifications = notificationItems.slice(
    (safeNotificationPage - 1) * notificationPageSize,
    safeNotificationPage * notificationPageSize,
  );
  const unread = notifications.data?.unread ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Signals"
        title="Alerts & notifications"
        description="Thresholds you control, deduplicated so a single spike does not spam you."
        actions={
          <Button variant="outline" size="sm" onClick={() => markAll.mutate()} loading={markAll.isPending} disabled={unread === 0}>
            <CheckCheck />
            Mark all read
          </Button>
        }
      />

      <Tabs
        value={activeTab}
        onValueChange={(next) => {
          if (next === 'alerts' || next === 'notifications' || next === 'settings') setActiveTab(next);
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="alerts">
              Alerts
              {counts.open ? <span className="ml-1.5 text-[10px] text-warning">{counts.open}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="notifications">
              Notifications
              {unread ? (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                  {unread}
                </span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="settings">Thresholds</TabsTrigger>
          </TabsList>

          {activeTab === 'alerts' ? (
            <Segmented
              ariaLabel="Filter alerts by severity"
              value={severity}
              onChange={setSeverity}
              options={[
                { value: 'all', label: `All ${counts.all}` },
                { value: 'critical', label: 'Critical' },
                { value: 'warning', label: 'Warning' },
                { value: 'info', label: 'Info' },
              ]}
            />
          ) : null}
        </div>

        <TabsContent value="alerts" className="mt-4 space-y-3">
          {alerts.isError ? (
            <InlineError message="Could not load alerts." onRetry={() => void alerts.refetch()} />
          ) : null}
          {alerts.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ) : null}

          {alerts.data && alerts.data.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No alerts yet"
              description="When consumption crosses a threshold you set, or a device goes offline, it appears here with a deterministic recommendation."
            />
          ) : null}

          {alerts.data && alerts.data.length > 0 && visibleAlerts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center">
              <p className="text-xs font-medium">No {severity} alerts</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Switch the filter to see other severities.</p>
            </div>
          ) : null}

          {pagedAlerts.map((alert) => {
            const meta = severityMeta[alert.severity];
            const Icon = meta.icon;
            return (
              <article
                key={alert.id}
                className={cn(
                  'panel relative flex items-start gap-4 overflow-hidden p-4 sm:p-5',
                  alert.acknowledgedAt && 'bg-card/60',
                )}
              >
                <span className={cn('absolute inset-y-0 left-0 w-0.5', meta.rail, alert.acknowledgedAt && 'opacity-40')} />
                <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', meta.iconBg)}>
                  <Icon className="h-4 w-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-sm font-semibold">{alert.title}</h2>
                    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', meta.chip)}>
                      {meta.label}
                    </span>
                    {!alert.acknowledgedAt ? <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="Unacknowledged" /> : null}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{alert.message}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                    <span>{formatDateTime(alert.createdAt)}</span>
                    <span className="font-mono">{alert.type}</span>
                    <span>· {timeAgo(alert.createdAt)}</span>
                  </div>
                </div>

                <div className="shrink-0">
                  {!alert.acknowledgedAt ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => acknowledge.mutate(alert.id)}
                      loading={acknowledge.isPending}
                    >
                      <Check />
                      Acknowledge
                    </Button>
                  ) : (
                    <Badge variant="neutral">
                      <Check className="h-3 w-3" />
                      Acknowledged
                    </Badge>
                  )}
                </div>
              </article>
            );
          })}

          {visibleAlerts.length > 0 ? (
            <div className="rounded-2xl border border-border/80 bg-card px-4 py-3 shadow-soft">
              <Pagination
                page={safeAlertPage}
                pageSize={alertPageSize}
                total={visibleAlerts.length}
                onPageChange={setAlertPage}
                onPageSizeChange={setAlertPageSize}
                pageSizeOptions={[8, 16, 32]}
                itemLabel="alerts"
                className="border-t-0 pt-0"
              />
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="notifications" className="mt-4 space-y-2">
          {notifications.isLoading ? <Skeleton className="h-32" /> : null}
          {notifications.data?.items.length === 0 ? (
            <EmptyState icon={BellRing} title="Nothing new" description="Notifications from alerts and your account appear here." />
          ) : null}
          {pagedNotifications.map((item) => (
            <article
              key={item.id}
              className={cn(
                'flex items-start gap-3 rounded-2xl border p-4 transition-colors',
                item.readAt ? 'border-border/70 bg-card/60' : 'border-primary/20 bg-primary/[0.035]',
              )}
            >
              <span
                className={cn(
                  'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                  item.readAt ? 'bg-border' : 'bg-primary',
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold">{item.title}</p>
                  {!item.readAt ? <Badge variant="neutral">New</Badge> : null}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
                <p className="mt-1.5 text-[10px] text-muted-foreground">{formatDateTime(item.createdAt)}</p>
              </div>
              {!item.readAt ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Mark ${item.title} as read`}
                  onClick={() => markOne.mutate(item.id)}
                >
                  <Check />
                </Button>
              ) : null}
            </article>
          ))}

          {notificationItems.length > 0 ? (
            <div className="rounded-2xl border border-border/80 bg-card px-4 py-3 shadow-soft">
              <Pagination
                page={safeNotificationPage}
                pageSize={notificationPageSize}
                total={notificationItems.length}
                onPageChange={setNotificationPage}
                onPageSizeChange={setNotificationPageSize}
                pageSizeOptions={[10, 20, 40]}
                itemLabel="notifications"
                className="border-t-0 pt-0"
              />
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <div className="panel p-5">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/[0.08] text-primary">
                  <SlidersHorizontal className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="font-display text-sm font-semibold">Alert thresholds</h2>
                  <p className="text-[11px] text-muted-foreground">Leave a field empty to disable that alert.</p>
                </div>
              </div>

              {preferences.isLoading ? <Skeleton className="mt-4 h-40" /> : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Power above (W)" hint="Fires on live draw, deduplicated per device.">
                  <Input
                    type="number"
                    value={value('powerThresholdW')}
                    onChange={(e) => setForm({ ...form, powerThresholdW: e.target.value })}
                    placeholder="2000"
                  />
                </Field>
                <Field label="Temperature above (°C)" hint="Only if the device senses temperature.">
                  <Input
                    type="number"
                    value={value('temperatureThresholdC')}
                    onChange={(e) => setForm({ ...form, temperatureThresholdC: e.target.value })}
                    placeholder="45"
                  />
                </Field>
                <Field label="Daily usage above (kWh)">
                  <Input
                    type="number"
                    value={value('dailyKwhThreshold')}
                    onChange={(e) => setForm({ ...form, dailyKwhThreshold: e.target.value })}
                    placeholder="12"
                  />
                </Field>
                <Field label="Monthly usage above (kWh)">
                  <Input
                    type="number"
                    value={value('monthlyKwhThreshold')}
                    onChange={(e) => setForm({ ...form, monthlyKwhThreshold: e.target.value })}
                    placeholder="300"
                  />
                </Field>
                <Field label="Estimated bill above (₹)" hint="Uses your configured tariff, estimate only.">
                  <Input
                    type="number"
                    value={value('billThreshold')}
                    onChange={(e) => setForm({ ...form, billThreshold: e.target.value })}
                    placeholder="2500"
                  />
                </Field>
              </div>

              <div className="mt-4 flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-muted/20 p-3.5">
                <div>
                  <p className="text-xs font-medium">Email notifications</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                    Sends through the configured SMTP server. Without SMTP, email is captured in the development outbox.
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
                  aria-label="Email notifications"
                />
              </div>

              <Button className="mt-4" onClick={() => savePrefs.mutate()} loading={savePrefs.isPending} disabled={!homeId}>
                Save thresholds
              </Button>
            </div>

            <div className="panel h-fit p-5">
              <h2 className="font-display text-sm font-semibold">Current thresholds</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Your saved limits, at a glance.</p>
              <dl className="mt-3 divide-y divide-border/70 text-[11px]">
                {[
                  ['Power', prefs?.powerThresholdW != null ? `${prefs.powerThresholdW} W` : 'Off'],
                  ['Temperature', prefs?.temperatureThresholdC != null ? `${prefs.temperatureThresholdC} °C` : 'Off'],
                  ['Daily usage', prefs?.dailyKwhThreshold != null ? `${prefs.dailyKwhThreshold} kWh` : 'Off'],
                  ['Monthly usage', prefs?.monthlyKwhThreshold != null ? `${prefs.monthlyKwhThreshold} kWh` : 'Off'],
                  ['Bill', prefs?.billThreshold != null ? `₹${prefs.billThreshold}` : 'Off'],
                  ['Email', prefs?.emailEnabled ? 'Enabled' : 'Disabled'],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-center justify-between py-2">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium">{val}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                Alerts are raised by the server from real telemetry. Acknowledging one never changes a device.
              </p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
