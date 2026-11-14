import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowUpRight,
  Bell,
  Cpu,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Moon,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useOutlet } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/BrandLogo';
import { FloatingWattbot, NotificationCenter } from '@/components/FloatingWidgets';
import { Seo } from '@/components/seo';
import { PageLoading } from '@/components/skeletons';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';
import { api } from '@/lib/api';
import { useRealtime } from '@/lib/socket';
import { cn, initials } from '@/lib/utils';
import type { WattbotPage } from '@wattnexa/shared';

function wattbotPage(pathname: string): WattbotPage {
  if (pathname.startsWith('/energy-analytics')) return 'energy';
  if (pathname.startsWith('/devices')) return 'devices';
  if (pathname.startsWith('/billing')) return 'billing';
  if (pathname.startsWith('/alerts')) return 'alerts';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/admin')) return 'admin';
  if (pathname === '/dashboard') return 'dashboard';
  return 'other';
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const primaryNav: NavItem[] = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/devices', label: 'Devices', icon: Cpu },
  { to: '/energy-analytics', label: 'Energy analytics', icon: LineChart },
  { to: '/billing', label: 'Billing', icon: ReceiptText },
  { to: '/wattbot', label: 'WattBot', icon: Sparkles },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings2 },
];

const pageLabels: Record<string, string> = {
  '/dashboard': 'Overview',
  '/devices': 'Devices',
  '/energy-analytics': 'Energy analytics',
  '/billing': 'Billing',
  '/wattbot': 'WattBot',
  '/alerts': 'Alerts',
  '/settings': 'Settings',
  '/admin': 'Admin',
  '/403': 'Access denied',
};

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
  category?: string | null;
  actions?: Array<{ key: string; label: string }> | null;
  metadata?: Record<string, unknown> | null;
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
  deviceId?: string | null;
  category?: string | null;
  actions?: Array<{ key: string; label: string }> | null;
  metadata?: Record<string, unknown> | null;
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

function SidebarLink({ item, onNavigate, badge }: { item: NavItem; onNavigate?: () => void; badge?: number }) {
  return (
    <NavLink to={item.to} end={item.end} onClick={onNavigate} className="group relative block">
      {({ isActive }) => (
        <span
          className={cn(
            'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition-colors duration-200',
            isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {isActive ? (
            <motion.span
              layoutId="app-nav-active"
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              className="absolute inset-0 rounded-xl border border-primary/15 bg-primary/[0.08]"
            />
          ) : (
            <span className="absolute inset-0 rounded-xl opacity-0 transition-opacity duration-200 group-hover:bg-muted/60 group-hover:opacity-100" />
          )}
          <item.icon className="relative h-4 w-4 shrink-0" />
          <span className="relative min-w-0 flex-1 truncate font-medium">{item.label}</span>
          {badge ? (
            <span className="relative flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {badge > 99 ? '99+' : badge}
            </span>
          ) : null}
          {isActive ? <span className="relative h-1 w-1 rounded-full bg-accent" /> : null}
        </span>
      )}
    </NavLink>
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
  const outlet = useOutlet();
  const queryClient = useQueryClient();
  const reducedMotion = useReducedMotion();

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationSnapshot>('/alerts/notifications'),
    refetchInterval: 60_000,
  });

  const { connected } = useRealtime({
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
                deviceId: payload.deviceId ?? null,
                category: payload.category ?? null,
                actions: payload.actions ?? null,
                metadata: payload.metadata ?? null,
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
    setOpen(false);
    setNotificationsOpen(false);
  }, [location.pathname]);

  const isAdmin = user && ['admin', 'super_admin', 'support_agent'].includes(user.role);
  const unread = notifications.data?.unread ?? 0;
  const currentLabel = pageLabels[location.pathname] ?? 'Workspace';

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-[72px] items-center px-5">
        <Link to="/dashboard" aria-label="WattNexa overview">
          <BrandLogo className="h-8 w-[150px]" />
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Main navigation">
        <p className="eyebrow px-3 pb-2 pt-1">Workspace</p>
        {primaryNav.slice(0, 4).map((item) => (
          <SidebarLink key={item.to} item={item} onNavigate={() => setOpen(false)} />
        ))}
        <p className="eyebrow px-3 pb-2 pt-4">Intelligence</p>
        {primaryNav.slice(4, 6).map((item) => (
          <SidebarLink
            key={item.to}
            item={item}
            onNavigate={() => setOpen(false)}
            badge={item.label === 'Alerts' ? unread : undefined}
          />
        ))}
        <div className="pt-4">
          <p className="eyebrow px-3 pb-2">Account</p>
          {primaryNav.slice(6).map((item) => (
            <SidebarLink key={item.to} item={item} onNavigate={() => setOpen(false)} />
          ))}
          {isAdmin ? (
            <SidebarLink
              item={{ to: '/admin', label: 'Admin', icon: ShieldCheck }}
              onNavigate={() => setOpen(false)}
            />
          ) : null}
        </div>
      </nav>

      <div className="px-3 pb-3">
        <Link
          to="/wattbot"
          onClick={() => setOpen(false)}
          className="group relative block overflow-hidden rounded-2xl border border-primary/15 bg-primary/[0.04] p-3.5 transition-colors hover:border-primary/30"
        >
          <span className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full bg-accent/25 blur-2xl" />
          <span className="relative flex items-center gap-2 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            WattBot
            <ArrowUpRight className="ml-auto h-3.5 w-3.5 opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </span>
          <span className="relative mt-1 block text-[11px] leading-relaxed text-muted-foreground">
            Ask what moved your bill, grounded in this household's readings.
          </span>
        </Link>
      </div>

      <div className="border-t border-border/70 p-3">
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary ring-1 ring-primary/15">
            {user ? initials(user.name) : '—'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{user?.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggle} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => void logout()}
            aria-label="Sign out"
          >
            <LogOut />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <Seo
        title={`${currentLabel} · WattNexa`}
        description="Private WattNexa workspace. Household energy readings, devices, billing estimates and alerts are visible only to authorised account members."
        path={location.pathname}
        noindex
      />
      <a
        href="#app-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-xs focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[420px] bg-gradient-to-b from-primary/[0.035] to-transparent" />

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] border-r border-border/70 bg-surface/70 backdrop-blur-xl lg:block">
        {sidebar}
      </aside>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 lg:hidden"
          >
            <button
              className="absolute inset-0 bg-secondary/50 backdrop-blur-sm"
              aria-label="Close navigation"
              onClick={() => setOpen(false)}
            />
            <motion.aside
              initial={{ x: reducedMotion ? 0 : -280 }}
              animate={{ x: 0 }}
              exit={{ x: reducedMotion ? 0 : -280 }}
              transition={{ type: 'tween', duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-y-0 left-0 w-[278px] border-r border-border bg-surface shadow-lift"
            >
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-4"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
              >
                <X />
              </Button>
              {sidebar}
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="relative lg:pl-[264px]">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border/60 bg-background/85 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>

          <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-2 text-xs">
            <Link to="/dashboard" className="hidden text-muted-foreground transition-colors hover:text-foreground sm:inline">
              Workspace
            </Link>
            <span className="hidden text-border sm:inline" aria-hidden="true">
              /
            </span>
            <span className="truncate font-medium text-foreground" aria-current="page">
              {currentLabel}
            </span>
          </nav>

          <span
            className={cn(
              'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium sm:inline-flex',
              connected
                ? 'border-primary/20 bg-primary/[0.06] text-primary'
                : 'border-border bg-muted/50 text-muted-foreground',
            )}
            title={
              connected
                ? 'Realtime updates are connected'
                : 'Realtime updates are reconnecting; readings still refresh on a timer'
            }
          >
            <span className={cn('live-dot', connected ? 'bg-primary text-primary' : 'bg-muted-foreground/50 text-muted-foreground')} />
            {connected ? 'Live' : 'Reconnecting'}
          </span>

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
          <Link
            to="/settings"
            aria-label="Open settings"
            className="ml-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground transition-transform hover:scale-105"
          >
            {user ? initials(user.name) : '—'}
          </Link>
        </header>

        <main id="app-content" className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={reducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              <Suspense fallback={<PageLoading label="Loading page" />}>{outlet}</Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <FloatingWattbot
        open={wattbotOpen}
        onOpenChange={setWattbotOpen}
        initialPrompt={wattbotPrompt?.text}
        initialPromptId={wattbotPrompt?.key}
        page={wattbotPage(location.pathname)}
      />
    </div>
  );
}
