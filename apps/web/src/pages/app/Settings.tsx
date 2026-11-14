import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  ChevronRight,
  Home,
  LogOut,
  Monitor,
  Moon,
  Palette,
  ReceiptText,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  User,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common';
import { Badge, Skeleton } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/forms';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useHomes } from '@/lib/hooks';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';
import { cn, formatDateTime, initials, timeAgo } from '@/lib/utils';

interface Session {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  lastUsedAt: string;
  createdAt: string;
  current: boolean;
}

type SectionId = 'profile' | 'security' | 'appearance' | 'energy' | 'account';

const sections: Array<{ id: SectionId; label: string; description: string; icon: LucideIcon }> = [
  { id: 'profile', label: 'Profile', description: 'Name, currency and timezone', icon: User },
  { id: 'security', label: 'Security', description: 'Password and sessions', icon: ShieldCheck },
  { id: 'appearance', label: 'Appearance', description: 'Theme and surfaces', icon: Palette },
  { id: 'energy', label: 'Energy preferences', description: 'Household, alerts and tariff', icon: SlidersHorizontal },
  { id: 'account', label: 'Account', description: 'Sign out and deletion', icon: Trash2 },
];

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD'];

export function Settings() {
  const { user, logout, refreshUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const { home } = useHomes();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [section, setSection] = useState<SectionId>('profile');
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
    onError: (error) => toast({ title: 'Could not revoke session', description: error.message, variant: 'error' }),
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
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Account, security, appearance and the preferences that shape your energy workspace."
      />

      <div className="grid gap-4 lg:grid-cols-[248px_1fr]">
        <nav
          aria-label="Settings sections"
          className="panel h-fit overflow-x-auto p-2 lg:sticky lg:top-24"
        >
          <div className="flex gap-1 lg:flex-col">
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                aria-current={section === item.id ? 'page' : undefined}
                className={cn(
                  'flex min-w-[148px] items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors',
                  section === item.id
                    ? 'bg-primary/[0.08] text-primary'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{item.label}</span>
                  <span className="mt-0.5 hidden truncate text-[10px] text-muted-foreground lg:block">
                    {item.description}
                  </span>
                </span>
                <ChevronRight
                  className={cn('hidden h-3.5 w-3.5 shrink-0 lg:block', section === item.id ? 'opacity-100' : 'opacity-0')}
                />
              </button>
            ))}
          </div>
        </nav>

        <div className="min-w-0 space-y-4">
          {section === 'profile' ? (
            <>
              <section className="panel p-5">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 font-display text-xl font-semibold text-primary ring-1 ring-primary/15">
                    {user ? initials(user.name) : '—'}
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-semibold">{user?.name}</h2>
                    <p className="text-xs text-muted-foreground">{user?.email}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant="neutral">{user?.role.replace('_', ' ')}</Badge>
                      {user?.emailVerified ? (
                        <Badge variant="default">
                          <ShieldCheck className="h-3 w-3" /> Email verified
                        </Badge>
                      ) : (
                        <Badge variant="warning">Email unverified</Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        Member since {user ? formatDateTime(user.createdAt) : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              <section className="panel p-5">
                <h2 className="font-display text-sm font-semibold">Personal details</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Your timezone and currency decide how timestamps and money are rendered. Stored data stays in UTC.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="Name">
                    <Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
                  </Field>
                  <Field label="Email" hint="Contact support to change the email on your account.">
                    <Input value={user?.email ?? ''} disabled />
                  </Field>
                  <Field label="Timezone" hint="IANA name, e.g. Asia/Kolkata.">
                    <Input
                      value={profile.timezone}
                      onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
                      placeholder="Asia/Kolkata"
                    />
                  </Field>
                  <Field label="Currency" hint="Used for bill estimates across the workspace.">
                    <Select
                      value={profile.currency}
                      onChange={(e) => setProfile({ ...profile, currency: e.target.value })}
                    >
                      {CURRENCIES.map((currency) => (
                        <option key={currency} value={currency}>
                          {currency}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Changes apply to every page after saving.
                  </p>
                  <Button onClick={() => saveProfile.mutate()} loading={saveProfile.isPending}>
                    Save profile
                  </Button>
                </div>
              </section>
            </>
          ) : null}

          {section === 'security' ? (
            <>
              <section className="panel p-5">
                <h2 className="font-display text-sm font-semibold">Change password</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  All other sessions are signed out when the password changes.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="Current password">
                    <Input
                      type="password"
                      autoComplete="current-password"
                      value={passwords.currentPassword}
                      onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
                    />
                  </Field>
                  <Field label="New password" hint="8+ characters with a letter and a number.">
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={passwords.newPassword}
                      onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
                    />
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
              </section>

              <section className="panel p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-sm font-semibold">Active sessions</h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Refresh tokens rotate; only a hash is stored server-side.
                    </p>
                  </div>
                  <Badge variant="neutral">{sessions.data?.length ?? 0} sessions</Badge>
                </div>

                {sessions.isLoading ? <Skeleton className="mt-3 h-20" /> : null}
                <div className="mt-3 divide-y divide-border/70">
                  {(sessions.data ?? []).map((session) => (
                    <div key={session.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
                          <Monitor className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 truncate text-[11px] font-medium">
                            {session.userAgent?.slice(0, 60) ?? 'Unknown device'}
                            {session.current ? <Badge variant="default">This device</Badge> : null}
                          </p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {session.ipAddress ?? 'unknown IP'} · active {timeAgo(session.lastUsedAt)} · started{' '}
                            {formatDateTime(session.createdAt)}
                          </p>
                        </div>
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

                <Button variant="outline" size="sm" className="mt-3" onClick={() => void logout()}>
                  <LogOut />
                  Sign out of this device
                </Button>
              </section>
            </>
          ) : null}

          {section === 'appearance' ? (
            <section className="panel p-5">
              <h2 className="font-display text-sm font-semibold">Theme</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Both modes are designed independently. Follows your system preference until you choose.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  { id: 'light' as const, label: 'Warm light', icon: Sun, hint: 'Off-white canvas, forest ink' },
                  { id: 'dark' as const, label: 'Charcoal dark', icon: Moon, hint: 'Green-tinted charcoal' },
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setTheme(option.id)}
                    aria-pressed={theme === option.id}
                    className={cn(
                      'rounded-2xl border p-3 text-left transition-all duration-200',
                      theme === option.id
                        ? 'border-primary/40 ring-1 ring-primary/20'
                        : 'border-border hover:border-primary/20',
                    )}
                  >
                    <div
                      className={cn(
                        'relative h-24 overflow-hidden rounded-xl border border-border',
                        option.id === 'light' ? 'bg-[#F6F6F0]' : 'bg-[#0C1211]',
                      )}
                    >
                      <div className="flex h-full">
                        <div className={cn('w-1/4 border-r', option.id === 'light' ? 'border-[#e3e5dc] bg-white/70' : 'border-white/10 bg-white/[0.03]')} />
                        <div className="flex-1 space-y-1.5 p-2.5">
                          <div className={cn('h-1.5 w-12 rounded-full', option.id === 'light' ? 'bg-[#0F5F47]/30' : 'bg-emerald-400/50')} />
                          <div className={cn('h-8 rounded-md border', option.id === 'light' ? 'border-[#e3e5dc] bg-white' : 'border-white/10 bg-white/[0.05]')} />
                          <div className="flex gap-1.5">
                            <div className={cn('h-5 flex-1 rounded-md border', option.id === 'light' ? 'border-[#e3e5dc] bg-white' : 'border-white/10 bg-white/[0.05]')} />
                            <div className={cn('h-5 flex-1 rounded-md', option.id === 'light' ? 'bg-[#0F5F47]' : 'bg-emerald-500/70')} />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between">
                      <div>
                        <p className="flex items-center gap-1.5 text-xs font-medium">
                          <option.icon className="h-3.5 w-3.5" />
                          {option.label}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{option.hint}</p>
                      </div>
                      {theme === option.id ? <Badge variant="default">Active</Badge> : null}
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-border/70 bg-muted/20 p-3.5">
                <p className="text-[11px] font-medium">A note on data colour</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  Charts use the same semantic palette in both themes: forest for measured energy, lime for highlights,
                  teal for demand. Simulated readings are always labelled, never colour-coded as real.
                </p>
              </div>
            </section>
          ) : null}

          {section === 'energy' ? (
            <>
              <section className="panel p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-muted/40 text-primary">
                      <Home className="h-4 w-4" />
                    </span>
                    <div>
                      <h2 className="font-display text-sm font-semibold">{home?.name ?? 'Household'}</h2>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {[home?.type, home?.city, home?.region].filter(Boolean).join(' · ') || 'No location set'}
                      </p>
                    </div>
                  </div>
                  <Badge variant="neutral">{home?.timezone ?? user?.timezone ?? 'UTC'}</Badge>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {[
                    { label: 'Devices', value: home?.devices.length ?? 0 },
                    { label: 'Online', value: home?.devices.filter((device) => device.status === 'online').length ?? 0 },
                    { label: 'Currency', value: user?.currency ?? 'INR' },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                      <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{stat.label}</p>
                      <p className="metric mt-1 text-lg font-semibold">{stat.value}</p>
                    </div>
                  ))}
                </div>
              </section>

              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  {
                    to: '/alerts?view=settings',
                    icon: Bell,
                    title: 'Alert thresholds',
                    copy: 'Power, temperature, daily and monthly kWh limits, and the bill ceiling.',
                  },
                  {
                    to: '/billing',
                    icon: ReceiptText,
                    title: 'Tariff and slabs',
                    copy: 'Progressive slabs, fixed charge and tax used by every cost estimate.',
                  },
                ].map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="panel group flex items-start gap-3 p-4 transition-colors hover:border-primary/25"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/[0.08] text-primary">
                      <item.icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold">{item.title}</span>
                      <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">{item.copy}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ))}
              </div>

              <section className="panel p-5">
                <h2 className="font-display text-sm font-semibold">Data honesty</h2>
                <ul className="mt-3 space-y-2 text-[11px] leading-relaxed text-muted-foreground">
                  <li>· Seeded and simulated readings are always tagged and labelled in the interface.</li>
                  <li>· Unavailable measurements stay empty, never zero-filled.</li>
                  <li>· Money figures are estimates from your tariff; your provider's bill remains authoritative.</li>
                </ul>
              </section>
            </>
          ) : null}

          {section === 'account' ? (
            <>
              <section className="panel p-5">
                <h2 className="font-display text-sm font-semibold">Sign out</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Ends this session. Other devices stay signed in until you revoke them.
                </p>
                <Button variant="outline" className="mt-3" onClick={() => void logout()}>
                  <LogOut />
                  Sign out
                </Button>
              </section>

              <section className="rounded-2xl border border-destructive/25 bg-destructive/[0.03] p-5">
                <h2 className="font-display text-sm font-semibold text-destructive">Delete account</h2>
                <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted-foreground">
                  Soft-deletes the account, anonymises the email and revokes every device credential. This cannot be
                  undone from the app.
                </p>
                <div className="mt-3 max-w-sm">
                  <Field label="Confirm with your password">
                    <Input
                      type="password"
                      autoComplete="current-password"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                    />
                  </Field>
                </div>
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
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
