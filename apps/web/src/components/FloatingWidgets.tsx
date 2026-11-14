import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  Bell,
  Check,
  CheckCheck,
  Cpu,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import type { NotificationAction, NotificationCategory } from '@wattnexa/types';
import type { WattbotPage } from '@wattnexa/shared';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Skeleton } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { WattbotLogo } from '@/components/BrandLogo';

const WattbotChat = lazy(() => import('@/pages/app/Wattbot').then((module) => ({ default: module.Wattbot })));

interface NotificationItem {
  id: string;
  alertId: string | null;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  alertType: string | null;
  severity: 'info' | 'warning' | 'critical' | null;
  deviceId: string | null;
  category?: NotificationCategory | null;
  actions?: NotificationAction[] | null;
  metadata?: Record<string, unknown> | null;
}

interface NotificationsResponse {
  items: NotificationItem[];
  unread: number;
}

const filterOptions = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'energy', label: 'Energy' },
  { value: 'device', label: 'Devices' },
  { value: 'account', label: 'Account' },
  { value: 'wattbot', label: 'WattBot' },
  { value: 'automation', label: 'Automation' },
] as const;

type NotificationFilter = (typeof filterOptions)[number]['value'];

type NotificationCategoryValue = NotificationCategory;

function categoryOf(item: NotificationItem): NotificationCategoryValue {
  if (item.category) return item.category;
  if (item.alertType === 'account') return 'account';
  if (item.alertType?.includes('wattbot')) return 'wattbot';
  if (item.alertType?.startsWith('automation')) return 'automation';
  if (item.alertType?.startsWith('device_') || item.deviceId) return 'device';
  if (
    ['high_power', 'unusual_consumption', 'daily_threshold', 'monthly_threshold', 'bill_threshold', 'high_temperature'].includes(
      item.alertType ?? '',
    )
  ) {
    return 'energy';
  }
  return 'system';
}

/** Fallback for a notification that arrived optimistically over Socket.IO. */
function fallbackActions(item: NotificationItem): NotificationAction[] {
  const cat = categoryOf(item);
  if (cat === 'energy') return [{ key: 'view_energy', label: 'View energy usage' }, { key: 'ask_wattbot', label: 'Ask WattBot' }];
  if (cat === 'device') {
    return [
      ...(item.deviceId ? [{ key: 'view_device' as const, label: 'View device' }] : []),
      { key: 'ask_wattbot', label: 'Ask WattBot' },
    ];
  }
  if (cat === 'account') return [{ key: 'view_account', label: 'View account' }];
  return [{ key: 'view_alerts', label: 'View alerts' }, { key: 'ask_wattbot', label: 'Ask WattBot' }];
}

function actionHref(action: NotificationAction, item: NotificationItem): string | null {
  switch (action.key) {
    case 'view_energy':
      return '/energy-analytics';
    case 'view_device':
      return item.deviceId ? `/devices?deviceId=${encodeURIComponent(item.deviceId)}` : '/devices';
    case 'view_alerts':
      return '/alerts';
    case 'view_account':
      return '/settings';
    case 'connection_help':
      return '/devices?help=connection';
    default:
      return null;
  }
}

function severityClass(severity: NotificationItem['severity']) {
  if (severity === 'critical') return 'bg-red-500';
  if (severity === 'warning') return 'bg-amber-500';
  return 'bg-sky-500';
}

function notificationTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function NotificationCenter({
  open,
  onOpenChange,
  onAskWattbot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAskWattbot: (question: string) => void;
}) {
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [expandedInsight, setExpandedInsight] = useState<Record<string, boolean>>({});
  const client = useQueryClient();
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationsResponse>('/alerts/notifications'),
  });
  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/alerts/notifications/${id}/read`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (error) => toast({ title: 'Could not update notification', description: error.message, variant: 'error' }),
  });
  const markAllRead = useMutation({
    mutationFn: () => api.post('/alerts/notifications/read-all'),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (error) => toast({ title: 'Could not update notifications', description: error.message, variant: 'error' }),
  });
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onOpenChange]);

  const items = (notifications.data?.items ?? []).filter((item) => {
    if (filter === 'unread') return !item.readAt;
    return filter === 'all' || categoryOf(item) === filter;
  });

  const scrollTabs = (direction: 'left' | 'right') => {
    if (tabsRef.current) {
      const scrollAmount = 160;
      tabsRef.current.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        aria-label={`Notifications${notifications.data?.unread ? `, ${notifications.data.unread} unread` : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative"
        onClick={() => onOpenChange(!open)}
      >
        <Bell />
        {notifications.data?.unread ? (
          <>
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
            <span className="absolute -right-2 -top-2 min-w-5 rounded-full bg-primary px-1 text-[10px] leading-5 text-primary-foreground">
              {notifications.data.unread > 99 ? '99+' : notifications.data.unread}
            </span>
          </>
        ) : null}
      </Button>

      <AnimatePresence>
        {open ? (
          <motion.section
            role="dialog"
            aria-modal="false"
            aria-label="Notifications"
            initial={{ opacity: 0, y: reducedMotion ? 0 : -8, scale: reducedMotion ? 1 : 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reducedMotion ? 0 : -6, scale: reducedMotion ? 1 : 0.98 }}
            transition={{ duration: reducedMotion ? 0 : 0.16 }}
            className="absolute right-0 top-12 z-[70] flex max-h-[min(680px,calc(100dvh-90px))] w-[min(32rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
          >
            {/* Fixed Header */}
            <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 bg-surface/95 backdrop-blur-sm">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold truncate">Notifications</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {notifications.data?.unread ?? 0} unread
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!notifications.data?.unread || markAllRead.isPending}
                  onClick={() => markAllRead.mutate()}
                  className="whitespace-nowrap"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Mark all read</span>
                </Button>
                <Button
                  ref={closeRef}
                  variant="ghost"
                  size="icon"
                  aria-label="Close notifications"
                  onClick={() => {
                    onOpenChange(false);
                    requestAnimationFrame(() => triggerRef.current?.focus());
                  }}
                >
                  <X />
                </Button>
              </div>
            </header>

            {/* Fixed Category Tabs - Horizontal Scroll with Hidden Scrollbar */}
            <nav
              ref={tabsRef}
              className="shrink-0 flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2 bg-surface/95 backdrop-blur-sm hide-scrollbar"
              aria-label="Notification categories"
            >
              {filterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filter === option.value}
                  onClick={() => setFilter(option.value)}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors whitespace-nowrap ${
                    filter === option.value
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </nav>

            {/* Scrollable Notification List */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              {notifications.isLoading ? (
                <div className="space-y-3 p-4" aria-label="Loading notifications">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </div>
              ) : notifications.isError ? (
                <div className="p-5 text-center">
                  <p className="text-xs text-muted-foreground">Notifications could not be loaded.</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => void notifications.refetch()}>
                    Try again
                  </Button>
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center px-6 py-10 text-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                    <Bell className="h-4 w-4 text-muted-foreground" />
                  </span>
                  <p className="mt-3 text-sm font-medium">You&apos;re all caught up</p>
                  <p className="mt-1 text-xs text-muted-foreground">New activity for your household will appear here.</p>
                </div>
              ) : (
                <ul className="divide-y divide-border px-4 py-3" role="list">
                  {items.map((item) => {
                    const insight =
                      typeof item.metadata?.wattbotInsight === 'string' ? item.metadata.wattbotInsight : null;
                    const actions = item.actions?.length ? item.actions : fallbackActions(item);
                    const asking = insight
                      ? `Explain this alert: ${item.title}. ${item.body} WattBot's recommendation: ${insight}`
                      : `Explain this alert: ${item.title}. ${item.body}`;
                    return (
                      <li
                        key={item.id}
                        className={`py-3 ${item.readAt ? '' : 'bg-primary/[0.03]'} transition-colors`}
                        style={{ borderBottomWidth: '1px' }}
                      >
                        <div className="flex items-start gap-3">
                          {/* Severity indicator + unread dot */}
                          <div className="flex flex-col items-center gap-2 shrink-0">
                            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severityClass(item.severity)}`} />
                            {!item.readAt && (
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            {/* Title row with badge */}
                            <div className="flex items-start justify-between gap-2">
                              <p className={`text-sm font-medium ${!item.readAt ? 'text-foreground' : 'text-muted-foreground'}`}>
                                {item.title}
                              </p>
                              {!item.readAt && (
                                <Badge variant="neutral" className="shrink-0">
                                  New
                                </Badge>
                              )}
                            </div>

                            {/* Description */}
                            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.body}</p>

                            {/* Timestamp */}
                            <p className="mt-1.5 text-[10px] text-muted-foreground">{notificationTime(item.createdAt)}</p>

                            {/* WattBot Insight - Expandable */}
                            {insight && (
                              <div className="mt-2">
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                                  onClick={() =>
                                    setExpandedInsight((current) => ({ ...current, [item.id]: !current[item.id] }))
                                  }
                                  aria-expanded={expandedInsight[item.id]}
                                >
                                  <Sparkles className="h-3 w-3" />
                                  {expandedInsight[item.id] ? 'Hide recommendation' : 'View recommendation'}
                                </button>
                                {expandedInsight[item.id] && (
                                  <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[11px] leading-relaxed animate-in fade-in">
                                    <p className="flex items-center gap-1 font-medium text-primary">
                                      <Sparkles className="h-3 w-3" />
                                      WattBot recommendation
                                    </p>
                                    <p className="mt-1 text-muted-foreground">{insight}</p>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Actions */}
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                              {actions.map((action) => {
                                if (action.key === 'ask_wattbot') {
                                  return (
                                    <button
                                      key={action.key}
                                      type="button"
                                      className="text-sm font-medium text-primary hover:underline"
                                      onClick={() => {
                                        if (!item.readAt) markRead.mutate(item.id);
                                        onOpenChange(false);
                                        onAskWattbot(asking);
                                      }}
                                    >
                                      {action.label}
                                    </button>
                                  );
                                }
                                if (action.key === 'view_recommendation') {
                                  return (
                                    <button
                                      key={action.key}
                                      type="button"
                                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                                      onClick={() =>
                                        setExpandedInsight((current) => ({ ...current, [item.id]: !current[item.id] }))
                                      }
                                    >
                                      <Sparkles className="h-3 w-3" />
                                      {expandedInsight[item.id] ? 'Hide recommendation' : action.label}
                                    </button>
                                  );
                                }
                                const href = actionHref(action, item);
                                if (!href) return null;
                                return (
                                  <Link
                                    key={action.key}
                                    to={href}
                                    onClick={() => {
                                      if (!item.readAt) markRead.mutate(item.id);
                                      onOpenChange(false);
                                    }}
                                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                                  >
                                    {categoryOf(item) === 'device' ? <Cpu className="h-3 w-3" /> : <Activity className="h-3 w-3" />}
                                    {action.label}
                                  </Link>
                                );
                              })}
                              {!item.readAt ? (
                                <button
                                  type="button"
                                  aria-label={`Mark "${item.title}" as read`}
                                  className="ml-auto rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                  onClick={() => markRead.mutate(item.id)}
                                >
                                  <Check className="h-4 w-4" />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Fixed Footer */}
            <footer className="shrink-0 flex items-center justify-between border-t border-border px-4 py-2.5 bg-surface/95 backdrop-blur-sm">
              <span className="text-[10px] text-muted-foreground">Recent activity</span>
              <Link
                to="/alerts?view=settings"
                onClick={() => onOpenChange(false)}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                <Settings className="h-3.5 w-3.5" />
                Notification settings
              </Link>
            </footer>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function FloatingWattbot({
  open,
  onOpenChange,
  initialPrompt,
  initialPromptId,
  page,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPrompt?: string;
  initialPromptId?: number;
  page?: WattbotPage;
}) {
  const [hasOpened, setHasOpened] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (PointerEvent: PointerEvent) => {
      if (!containerRef.current?.contains(PointerEvent.target as Node)) onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={containerRef} className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-[60] sm:right-6">
      <motion.div
        role="dialog"
        aria-label="WattBot assistant"
        aria-modal="false"
        aria-hidden={!open}
        initial={false}
        animate={{
          opacity: open ? 1 : 0,
          y: open ? 0 : reducedMotion ? 0 : 12,
          scale: open || reducedMotion ? 1 : 0.98,
        }}
        transition={{ duration: reducedMotion ? 0 : 0.18 }}
        style={{ visibility: open ? 'visible' : 'hidden', pointerEvents: open ? 'auto' : 'none' }}
        className="fixed inset-x-2 bottom-[max(1rem,env(safe-area-inset-bottom))] top-16 z-[60] flex flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-lift sm:inset-auto sm:bottom-20 sm:right-6 sm:top-auto sm:h-[min(42rem,calc(100dvh-7rem))] sm:w-[min(31rem,calc(100vw-3rem))]"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border bg-surface px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <WattbotLogo className="h-9 w-9" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">WattBot</p>
              <p className="truncate text-[10px] text-muted-foreground">Your energy assistant</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close WattBot"
              onClick={() => {
                onOpenChange(false);
                triggerRef.current?.focus();
              }}
            >
              <X />
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 p-2 sm:p-3">
          {hasOpened ? (
            <Suspense fallback={<div className="space-y-3 p-3"><Skeleton className="h-10" /><Skeleton className="h-40" /></div>}>
              <WattbotChat compact initialPrompt={initialPrompt} initialPromptId={initialPromptId} page={page} />
            </Suspense>
          ) : null}
        </div>
      </motion.div>

      <motion.button
        ref={triggerRef}
        type="button"
        aria-label={open ? 'Close WattBot' : 'Open WattBot'}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        animate={reducedMotion ? undefined : { scale: [1, 1.025, 1] }}
        transition={reducedMotion ? undefined : { duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
        className={`relative flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-secondary shadow-lift transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${open ? 'hidden' : ''}`}
      >
        <WattbotLogo className="h-11 w-11" />
      </motion.button>
    </div>
  );
}