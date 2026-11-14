import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, Home, ShieldCheck, Users, Zap } from 'lucide-react';
import { PageHeader } from '@/components/common';
import { Badge, Skeleton, Table, Td, Th } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/forms';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { formatNumber } from '@wattnexa/shared';
import { formatDateTime } from '@/lib/utils';

interface Overview {
  users: number;
  devices: number;
  homes: number;
  alerts: number;
  deviceStatus: Array<{ status: string; count: number }>;
  planDistribution: Array<{ plan: string; count: number }>;
  monitoredEnergyKwh: number;
  recentAlerts: Array<{ id: string; title: string; severity: string; createdAt: string }>;
}

interface UsersResponse {
  items: Array<{
    id: string;
    email: string;
    name: string;
    role: string;
    isSuspended: boolean;
    createdAt: string;
    lastLoginAt: string | null;
  }>;
  total: number;
}

interface AuditResponse {
  items: Array<{ id: string; action: string; resourceType: string; resourceId: string | null; createdAt: string }>;
}

export function Admin() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.get<Overview>('/admin/overview') });
  const users = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.get<UsersResponse>('/admin/users?pageSize=50'),
  });
  const audit = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => api.get<AuditResponse>('/admin/audit-logs?pageSize=15'),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/admin/users/${id}`, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast({ title: 'User updated', variant: 'success' });
    },
    onError: (error) => toast({ title: 'Update failed', description: error.message, variant: 'error' }),
  });

  const stats = [
    { label: 'Registered users', value: overview.data?.users, icon: Users },
    { label: 'Households', value: overview.data?.homes, icon: Home },
    { label: 'Devices', value: overview.data?.devices, icon: Cpu },
    { label: 'Monitored energy', value: overview.data ? `${formatNumber(overview.data.monitoredEnergyKwh, 0)} kWh` : undefined, icon: Zap },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin workspace"
        description="Platform metrics, accounts and the audit trail."
        actions={<Badge variant="outline"><ShieldCheck className="h-3 w-3" /> Restricted access</Badge>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{stat.label}</p>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            {overview.isLoading ? (
              <Skeleton className="mt-3 h-7 w-20" />
            ) : (
              <p className="mt-2 text-2xl font-semibold">{stat.value ?? '—'}</p>
            )}
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm font-semibold">Device status</p>
          <ul className="mt-3 space-y-2 text-xs">
            {(overview.data?.deviceStatus ?? []).map((row) => (
              <li key={row.status} className="flex justify-between">
                <span className="capitalize text-muted-foreground">{row.status}</span>
                <span>{row.count}</span>
              </li>
            ))}
            {overview.data?.deviceStatus.length === 0 ? (
              <li className="text-muted-foreground">No devices yet.</li>
            ) : null}
          </ul>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-semibold">Plan distribution</p>
          <ul className="mt-3 space-y-2 text-xs">
            {(overview.data?.planDistribution ?? []).map((row) => (
              <li key={row.plan} className="flex justify-between">
                <span className="text-muted-foreground">{row.plan}</span>
                <span>{row.count}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-semibold">Recent alerts</p>
          <ul className="mt-3 space-y-2 text-xs">
            {(overview.data?.recentAlerts ?? []).slice(0, 5).map((alert) => (
              <li key={alert.id} className="truncate text-muted-foreground">
                <span className="text-foreground">{alert.title}</span> · {formatDateTime(alert.createdAt)}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold">Users</p>
          <span className="text-xs text-muted-foreground">{users.data?.total ?? 0} total</span>
        </div>
        {users.isLoading ? <Skeleton className="h-40" /> : null}
        <Table>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Joined</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {(users.data?.items ?? []).map((user) => (
              <tr key={user.id}>
                <Td>
                  <p className="text-sm">{user.name}</p>
                  <p className="text-[11px] text-muted-foreground">{user.email}</p>
                </Td>
                <Td>
                  <Select
                    className="h-8 w-36 text-xs"
                    value={user.role}
                    onChange={(event) => updateUser.mutate({ id: user.id, body: { role: event.target.value } })}
                  >
                    {['user', 'support_agent', 'admin', 'super_admin'].map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </Select>
                </Td>
                <Td>
                  <Badge variant={user.isSuspended ? 'danger' : 'default'}>
                    {user.isSuspended ? 'suspended' : 'active'}
                  </Badge>
                </Td>
                <Td className="text-xs text-muted-foreground">{formatDateTime(user.createdAt)}</Td>
                <Td className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updateUser.mutate({ id: user.id, body: { isSuspended: !user.isSuspended } })}
                  >
                    {user.isSuspended ? 'Reactivate' : 'Suspend'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card className="p-5">
        <p className="text-sm font-semibold">Audit trail</p>
        <p className="mb-3 text-xs text-muted-foreground">Sensitive administrative actions, newest first.</p>
        {audit.isLoading ? <Skeleton className="h-32" /> : null}
        <div className="divide-y divide-border text-xs">
          {(audit.data?.items ?? []).map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="font-mono text-[11px] text-foreground">{entry.action}</span>
              <span className="text-muted-foreground">
                {entry.resourceType}
                {entry.resourceId ? ` · ${entry.resourceId.slice(0, 8)}` : ''} · {formatDateTime(entry.createdAt)}
              </span>
            </div>
          ))}
          {audit.data?.items.length === 0 ? (
            <p className="py-3 text-muted-foreground">No audit entries yet.</p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
