import {
  BarChart3,
  Bell,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  ReceiptIndianRupee,
  Settings as SettingsIcon,
  Shield,
  Sun,
  Cpu,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Badge } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { BrandLogo, WattbotLogo } from '@/components/BrandLogo';
import { FloatingWattbot, NotificationCenter } from '@/components/FloatingWidgets';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useRealtime } from '@/lib/socket';
import { cn, initials } from '@/lib/utils';

function WattbotNavIcon({ className }: { className?: string }) {
  return <WattbotLogo className={className} />;
}

const navItems = [
  { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/app/devices', label: 'Devices', icon: Cpu },
  { to: '/app/energy', label: 'Energy', icon: BarChart3 },
  { to: '/app/billing', label: 'Billing', icon: ReceiptIndianRupee },
  { to: '/app/wattbot', label: 'WattBot', icon: WattbotNavIcon },
  { to: '/app/alerts', label: 'Alerts', icon: Bell },
  { to: '/app/settings', label: 'Settings', icon: SettingsIcon },
];

interface NotificationSnapshotItem {
  id: string;
  alertId: string | null;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  alertType: string | null;
  severity: 'info' | 'warning' | 'critical' | null;
  deviceId: string | null;
}

interface NotificationSnapshot {
  items: NotificationSnapshotItem[];
  unread: number;
}

function isRealtimeNotification(payload: unknown): payload is {
  id: string;
  alertId: string;
  title: string;
  body: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  createdAt: string;
} {
  if (!payload || typeof payload !== 'object') return false;
  const item = payload as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.alertId === 'string' &&
    typeof item.title === 'string' &&
    typeof item.body === 'string' &&
    typeof item.type === 'string' &&
    ['info', 'warning', 'critical'].includes(String(item.severity)) &&
    typeof item.createdAt === 'string'
  );
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [wattbotOpen, setWattbotOpen] = useState(false);
  const [wattbotPrompt, setWattbotPrompt] = useState<{ key: number; text: string } | null>(null);
  const location = useLocation();
  const queryClient = useQueryClient();

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationSnapshot>('/alerts/notifications'),
    refetchInterval: 60_000,
  });
  useRealtime({
    'notification:new': (payload) => {
      if (isRealtimeNotification(payload)) {
        queryClient.setQueryData<NotificationSnapshot>(['notifications'], (current) => {
          if (!current || current.items.some((item) => item.id === payload.id)) return current;
          return {
            items: [
              {
                id: payload.id,
                alertId: payload.alertId,
                title: payload.title,
                body: payload.body,
                readAt: null,
                createdAt: payload.createdAt,
                alertType: payload.type,
                severity: payload.severity,
                deviceId: null,
              },
              ...current.items,
            ].slice(0, 50),
            unread: current.unread + 1,
          };
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    'alert:new': () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    connect: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    if (location.pathname.startsWith('/app/wattbot')) setWattbotOpen(true);
  }, [location.pathname]);

  const isAdmin = user && ['admin', 'super_admin', 'support_agent'].includes(user.role);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <BrandLogo className="h-9 w-[162px]" />
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex items-center justify-between rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                isActive && 'bg-primary/10 font-medium text-primary hover:bg-primary/15 hover:text-primary',
              )
            }
          >
            <span className="flex items-center gap-2.5">
              <item.icon className="h-4 w-4" />
              {item.label}
            </span>
            {item.label === 'Alerts' && notifications.data?.unread ? (
              <Badge variant="danger">{notifications.data.unread}</Badge>
            ) : null}
          </NavLink>
        ))}
        {isAdmin ? (
          <NavLink
            to="/app/admin"
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                isActive && 'bg-primary/10 font-medium text-primary',
              )
            }
          >
            <Shield className="h-4 w-4" />
            Admin
          </NavLink>
        ) : null}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            {user ? initials(user.name) : '—'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{user?.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <div className="mt-1 flex gap-1">
          <Button variant="ghost" size="sm" className="flex-1 justify-start" onClick={() => void logout()}>
            <LogOut />
            Sign out
          </Button>
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border bg-surface lg:block">
        {sidebar}
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            className="absolute inset-0 bg-black/60"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-surface">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-3"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
            >
              <X />
            </Button>
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <div className="flex flex-1 items-center gap-2">
            <Gauge className="hidden h-4 w-4 text-muted-foreground sm:block" />
            <span className="text-sm font-medium">Energy workspace</span>
          </div>
          <NotificationCenter
            open={notificationsOpen}
            onOpenChange={setNotificationsOpen}
            onAskWattbot={(text) => {
              setWattbotPrompt({ key: Date.now(), text });
              setWattbotOpen(true);
            }}
          />
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme" className="hidden sm:inline-flex">
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </header>

        <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>

      <FloatingWattbot
        open={wattbotOpen}
        onOpenChange={setWattbotOpen}
        initialPrompt={wattbotPrompt?.text}
        initialPromptId={wattbotPrompt?.key}
      />
    </div>
  );
}
