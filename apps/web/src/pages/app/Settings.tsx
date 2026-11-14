import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Monitor, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common';
import { Badge, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/forms';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';
import { formatDateTime, timeAgo } from '@/lib/utils';

interface Session {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  lastUsedAt: string;
  createdAt: string;
  current: boolean;
}

export function Settings() {
  const { user, logout, refreshUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [profile, setProfile] = useState({ name: '', timezone: 'Asia/Kolkata', currency: 'INR' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [deletePassword, setDeletePassword] = useState('');

  useEffect(() => {
    if (user) setProfile({ name: user.name, timezone: user.timezone, currency: user.currency });
  }, [user]);

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<Session[]>('/auth/sessions'),
  });

  const saveProfile = useMutation({
    mutationFn: () => api.patch('/auth/me', profile),
    onSuccess: async () => {
      await refreshUser();
      toast({ title: 'Profile updated', variant: 'success' });
    },
    onError: (error) => toast({ title: 'Could not update profile', description: error.message, variant: 'error' }),
  });

  const changePassword = useMutation({
    mutationFn: () => api.post('/auth/change-password', passwords),
    onSuccess: () => {
      toast({ title: 'Password changed', description: 'Sign in again with the new password.', variant: 'success' });
      void navigate('/login');
    },
    onError: (error) => toast({ title: 'Could not change password', description: error.message, variant: 'error' }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/auth/sessions/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  const deleteAccount = useMutation({
    mutationFn: () => api.del('/auth/account', { password: deletePassword }),
    onSuccess: async () => {
      await logout();
      void navigate('/');
    },
    onError: (error) => toast({ title: 'Could not delete account', description: error.message, variant: 'error' }),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Account, security and preferences." />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="danger">Danger zone</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <Card className="max-w-2xl p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
              </Field>
              <Field label="Email" hint="Contact support to change the email on your account.">
                <Input value={user?.email ?? ''} disabled />
              </Field>
              <Field label="Timezone">
                <Input value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })} />
              </Field>
              <Field label="Currency">
                <Input value={profile.currency} maxLength={3} onChange={(e) => setProfile({ ...profile, currency: e.target.value.toUpperCase() })} />
              </Field>
            </div>
            <Button className="mt-4" onClick={() => saveProfile.mutate()} loading={saveProfile.isPending}>
              Save profile
            </Button>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-4 space-y-4">
          <Card className="max-w-2xl p-5">
            <p className="text-sm font-semibold">Change password</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Current password">
                <Input type="password" value={passwords.currentPassword} onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })} />
              </Field>
              <Field label="New password" hint="8+ characters with a letter and a number.">
                <Input type="password" value={passwords.newPassword} onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })} />
              </Field>
            </div>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => changePassword.mutate()}
              loading={changePassword.isPending}
              disabled={!passwords.currentPassword || passwords.newPassword.length < 8}
            >
              Update password
            </Button>
            <p className="mt-2 text-[11px] text-muted-foreground">
              All other sessions are signed out when the password changes.
            </p>
          </Card>

          <Card className="max-w-2xl p-5">
            <p className="text-sm font-semibold">Active sessions</p>
            {sessions.isLoading ? <Skeleton className="mt-3 h-20" /> : null}
            <div className="mt-3 divide-y divide-border">
              {(sessions.data ?? []).map((session) => (
                <div key={session.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-xs font-medium">
                      <Monitor className="h-3.5 w-3.5 shrink-0" />
                      {session.userAgent?.slice(0, 60) ?? 'Unknown device'}
                      {session.current ? <Badge variant="default">This device</Badge> : null}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {session.ipAddress ?? 'unknown IP'} · active {timeAgo(session.lastUsedAt)} · started{' '}
                      {formatDateTime(session.createdAt)}
                    </p>
                  </div>
                  {!session.current ? (
                    <Button variant="ghost" size="sm" onClick={() => revoke.mutate(session.id)}>
                      <LogOut className="h-3.5 w-3.5" />
                      Revoke
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="appearance" className="mt-4">
          <Card className="max-w-md p-5">
            <p className="text-sm font-semibold">Theme</p>
            <p className="mb-3 text-xs text-muted-foreground">Follows your system preference by default.</p>
            <div className="flex gap-2">
              <Button variant={theme === 'light' ? 'default' : 'outline'} size="sm" onClick={() => setTheme('light')}>
                Light
              </Button>
              <Button variant={theme === 'dark' ? 'default' : 'outline'} size="sm" onClick={() => setTheme('dark')}>
                Dark
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="danger" className="mt-4">
          <Card className="max-w-md border-destructive/30 p-5">
            <p className="text-sm font-semibold text-destructive">Delete account</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Soft-deletes the account, anonymises the email and revokes every device credential. This cannot be
              undone from the app.
            </p>
            <Field label="Confirm with your password" className="mt-3">
              <Input type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} />
            </Field>
            <Button
              variant="destructive"
              className="mt-3"
              disabled={!deletePassword}
              loading={deleteAccount.isPending}
              onClick={() => {
                if (window.confirm('Delete this account permanently?')) deleteAccount.mutate();
              }}
            >
              <Trash2 />
              Delete account
            </Button>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
