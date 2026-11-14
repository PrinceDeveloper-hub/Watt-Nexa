import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpRight,
  Copy,
  History,
  Info,
  Menu,
  Plus,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
  User,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Markdown } from '@/components/markdown';
import { PageHeader } from '@/components/common';
import { Pagination } from '@/components/pagination';
import { Badge, Skeleton } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/forms';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useHomes } from '@/lib/hooks';
import type { WattbotPage } from '@wattnexa/shared';
import { streamWattbot, type StreamMeta, type WattbotQuota } from '@/lib/wattbot-stream';
import { cn, timeAgo } from '@/lib/utils';
import { WattbotLogo } from '@/components/BrandLogo';

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  provider?: string;
  fallbackReason?: string | null;
  streaming?: boolean;
  context?: StreamMeta['context'];
}

interface ProviderStatus {
  provider: 'none' | 'openai' | 'anthropic';
  model: string | null;
  configured: boolean;
  reason: string | null;
  quota: WattbotQuota;
}

interface SeriesPoint {
  timestamp: string;
  energyKwh: number;
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const PROVIDER_LABEL: Record<string, string> = {
  rule_based: 'Data analysis',
  openai: 'OpenAI',
  anthropic: 'Claude',
};

export function Wattbot({
  compact = false,
  initialPrompt,
  initialPromptId,
  page,
}: {
  compact?: boolean;
  initialPrompt?: string;
  initialPromptId?: number;
  /** Current screen, used for suggestions and answer emphasis. */
  page?: WattbotPage;
} = {}) {
  const { homeId } = useHomes();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [lastQuestion, setLastQuestion] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(8);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const conversations = useQuery({
    queryKey: ['wattbot', 'conversations'],
    queryFn: () => api.get<ConversationSummary[]>('/wattbot/conversations'),
  });

  const status = useQuery({
    queryKey: ['wattbot', 'status'],
    queryFn: () => api.get<ProviderStatus>('/wattbot/status'),
  });

  const series = useQuery({
    queryKey: ['wattbot', 'series', homeId],
    queryFn: () => api.get<SeriesPoint[]>(`/wattbot/series?homeId=${homeId}&days=7`),
    enabled: Boolean(homeId),
  });

  const contextual = useQuery({
    queryKey: ['wattbot', 'suggestions', homeId, page],
    queryFn: () =>
      api.get<string[]>(`/wattbot/suggestions?homeId=${homeId}${page ? `&page=${encodeURIComponent(page)}` : ''}`),
    enabled: Boolean(homeId),
  });

  useEffect(() => {
    if (contextual.data) setSuggestions(contextual.data);
  }, [contextual.data]);

  useEffect(() => {
    if (initialPrompt) setInput(initialPrompt);
  }, [initialPrompt, initialPromptId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    setHistoryPage(1);
  }, [historyPageSize]);

  const reset = () => {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setInput('');
    setLastQuestion('');
    setError(null);
    setStreaming(false);
    setSidebarOpen(false);
  };

  const deleteConversation = useMutation({
    mutationFn: (id: string) => api.del(`/wattbot/conversations/${id}`),
    onSuccess: async (_data, id) => {
      if (id === conversationId) reset();
      await queryClient.invalidateQueries({ queryKey: ['wattbot', 'conversations'] });
    },
  });

  const openConversation = async (id: string) => {
    setSidebarOpen(false);
    try {
      const data = await api.get<{ messages: ChatMessage[] }>(`/wattbot/conversations/${id}`);
      setConversationId(id);
      setMessages(data.messages.map((message) => ({ ...message, streaming: false })));
      setError(null);
    } catch (cause) {
      toast({
        title: 'Could not open that conversation',
        description: cause instanceof Error ? cause.message : undefined,
        variant: 'error',
      });
    }
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || streaming || !homeId) return;

    setInput('');
    setLastQuestion(text);
    setError(null);
    setStreaming(true);
    const now = new Date().toISOString();
    setMessages((current) => [
      ...current,
      { id: `u-${Date.now()}`, role: 'user', content: text, createdAt: now },
      { id: `a-${Date.now()}`, role: 'assistant', content: '', createdAt: now, streaming: true },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamWattbot(
        {
          message: text,
          conversationId: conversationId ?? undefined,
          homeId,
          ...(page ? { context: { page } } : {}),
        },
        {
          onMeta: (meta) => {
            setConversationId(meta.conversationId);
            if (meta.suggestions.length) setSuggestions(meta.suggestions);
          },
          onDelta: (delta) =>
            setMessages((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.role === 'assistant') {
                next[next.length - 1] = { ...last, content: last.content + delta };
              }
              return next;
            }),
          onDone: (done) => {
            setMessages((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.role === 'assistant') {
                next[next.length - 1] = {
                  ...last,
                  id: done.messageId,
                  streaming: false,
                  provider: done.provider,
                  fallbackReason: done.fallbackReason,
                  context: done.context,
                };
              }
              return next;
            });
            void queryClient.invalidateQueries({ queryKey: ['wattbot', 'conversations'] });
            void queryClient.invalidateQueries({ queryKey: ['wattbot', 'status'] });
          },
        },
        controller.signal,
      );
    } catch (cause) {
      if (controller.signal.aborted) return;
      const message = cause instanceof Error ? cause.message : 'WattBot could not answer that.';
      setError(message);
      void queryClient.invalidateQueries({ queryKey: ['wattbot', 'status'] });
      setMessages((current) => {
        const next = [...current];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && !last.content) next.pop();
        return next;
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const provider = status.data;
  const quota = provider?.quota;
  // Server enforces this too; the UI just refuses to send doomed requests.
  const quotaBlocked = Boolean(quota && (!quota.included || quota.remainingToday <= 0));
  const seriesMax = Math.max(...(series.data ?? []).map((point) => point.energyKwh), 0.001);
  const seriesTotal = (series.data ?? []).reduce((sum, point) => sum + point.energyKwh, 0);
  const conversationItems = conversations.data ?? [];
  const historyTotalPages = Math.max(1, Math.ceil(conversationItems.length / historyPageSize));
  const safeHistoryPage = Math.min(historyPage, historyTotalPages);
  const pagedConversations = conversationItems.slice(
    (safeHistoryPage - 1) * historyPageSize,
    safeHistoryPage * historyPageSize,
  );

  const sidebar = (
    <div className="flex h-full flex-col gap-4">
      <Button variant="outline" className="w-full justify-start" onClick={reset}>
        <Plus />
        New conversation
      </Button>

      <div className="flex min-h-0 flex-1 flex-col">
        <p className="eyebrow px-1 pb-2">History</p>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 scrollbar-thin">
          {conversations.isLoading ? <Skeleton className="h-16" /> : null}
          {pagedConversations.map((conversation) => (
            <div key={conversation.id} className="group flex items-center gap-1">
              <button
                onClick={() => void openConversation(conversation.id)}
                className={cn(
                  'min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left transition-colors',
                  conversationId === conversation.id
                    ? 'bg-primary/[0.08] text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
                title={conversation.title}
              >
                <span className="block truncate text-[11px] font-medium">{conversation.title}</span>
                <span className="mt-0.5 block text-[9px] text-muted-foreground">
                  {timeAgo(conversation.updatedAt)}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 opacity-0 focus:opacity-100 group-hover:opacity-100"
                onClick={() => deleteConversation.mutate(conversation.id)}
                aria-label={`Delete ${conversation.title}`}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          {conversationItems.length === 0 ? (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">No conversations yet.</p>
          ) : null}
        </div>

        {conversationItems.length > historyPageSize ? (
          <Pagination
            page={safeHistoryPage}
            pageSize={historyPageSize}
            total={conversationItems.length}
            onPageChange={setHistoryPage}
            onPageSizeChange={setHistoryPageSize}
            pageSizeOptions={[8, 16, 24]}
            itemLabel="chats"
            className="mt-2"
          />
        ) : null}
      </div>

      {series.data && series.data.length > 0 ? (
        <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
          <div className="flex items-baseline justify-between">
            <p className="eyebrow">Last 7 days</p>
            <span className="text-[10px] font-medium">{seriesTotal.toFixed(1)} kWh</span>
          </div>
          <div className="mt-2.5 flex h-16 items-end gap-1">
            {series.data.map((point) => (
              <div
                key={point.timestamp}
                className="flex-1 rounded-sm bg-primary/60 transition-colors hover:bg-primary"
                style={{ height: `${Math.max(5, (point.energyKwh / seriesMax) * 100)}%` }}
                title={`${point.timestamp.slice(0, 10)}: ${point.energyKwh.toFixed(1)} kWh`}
              />
            ))}
          </div>
          <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground">
            Measured totals per day. Nothing here is estimated.
          </p>
        </div>
      ) : null}
    </div>
  );

  const suggestionsBlock = (variant: 'hero' | 'inline') =>
    suggestions.length ? (
      <div className={cn('flex flex-wrap gap-2', variant === 'hero' && 'max-w-2xl justify-center')}>
        {suggestions.slice(0, variant === 'hero' ? 6 : 3).map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => void send(suggestion)}
            className={cn(
              'text-left transition-all duration-200',
              variant === 'hero'
                ? 'flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 text-[11px] shadow-soft hover:-translate-y-0.5 hover:border-primary/30'
                : 'rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground',
            )}
          >
            {variant === 'hero' ? <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
            <span className={variant === 'hero' ? 'font-medium' : undefined}>{suggestion}</span>
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div className={compact ? 'flex h-full min-h-0 flex-col gap-2' : 'space-y-5'}>
      {!compact ? (
        <PageHeader
          eyebrow="Assistant"
          title="WattBot"
          description="Answers grounded in this household's readings, tariff and device state — nothing else."
          actions={
            <>
              <Badge variant={provider?.configured ? 'neutral' : 'outline'}>
                <Sparkles className="h-3 w-3" />
                {provider?.configured ? `AI: ${provider.provider}` : 'Data analysis mode'}
              </Badge>
              <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
                <History />
                History
              </Button>
            </>
          }
        />
      ) : (
        <div className="flex shrink-0 items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => setSidebarOpen(true)}>
            <Menu />
            History
          </Button>
          <Button variant="outline" size="sm" onClick={reset}>
            <Plus />
            New chat
          </Button>
        </div>
      )}

      {!compact && provider && !provider.configured ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p>
            {provider.reason} Answers are computed directly from your stored readings and tariff — no text is sent to an
            external AI provider.
          </p>
        </div>
      ) : null}

      {quota && !quota.included ? (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/20 bg-primary/[0.04] p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            WattBot is part of the <strong>Plus</strong> and <strong>Pro</strong> plans. You are on{' '}
            <strong>{quota.planName}</strong>, which does not include it.
          </p>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link to="/billing">Compare plans</Link>
          </Button>
        </div>
      ) : null}

      {quota?.included && quota.remainingToday <= 0 ? (
        <div className="rounded-xl border border-warning/25 bg-warning/[0.06] p-3 text-[11px] leading-relaxed text-warning">
          Daily limit reached — {quota.usedToday} of {quota.limitPerDay} messages used. Resets{' '}
          {new Date(quota.resetAt).toLocaleString()}.
        </div>
      ) : null}

      <div className={cn('grid gap-4', compact ? 'min-h-0 flex-1 grid-cols-1' : 'lg:grid-cols-[264px_1fr]')}>
        {!compact ? <div className="hidden rounded-2xl border border-border/80 bg-card p-4 shadow-soft lg:block">{sidebar}</div> : null}

        <AnimatePresence>
          {sidebarOpen ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 lg:hidden"
            >
              <button
                className="absolute inset-0 bg-secondary/50 backdrop-blur-sm"
                aria-label="Close history"
                onClick={() => setSidebarOpen(false)}
              />
              <motion.div
                initial={{ x: -300 }}
                animate={{ x: 0 }}
                exit={{ x: -300 }}
                transition={{ type: 'tween', duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-y-0 left-0 w-[290px] border-r border-border bg-surface p-4 shadow-lift"
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-display text-sm font-semibold">Conversations</p>
                  <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} aria-label="Close">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {sidebar}
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div
          className={cn(
            'flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-soft',
            compact ? 'h-full' : 'h-[calc(100dvh-13rem)] min-h-[520px]',
          )}
        >
          <div className="flex flex-1 flex-col overflow-y-auto scrollbar-thin">
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-5 px-5 py-10 text-center">
                <div className="relative">
                  <span className="absolute inset-0 -z-10 scale-150 rounded-full bg-primary/10 blur-2xl" />
                  <WattbotLogo className="h-14 w-14" />
                </div>
                <div>
                  <p className="font-display text-lg font-semibold">
                    {compact ? 'Ask about your electricity' : 'Your energy consultant, grounded in facts'}
                  </p>
                  <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
                    I only see this household. If a number is not in your readings, I will say so instead of guessing —
                    and I never attribute load to a specific appliance from one whole-house sensor.
                  </p>
                </div>
                {suggestionsBlock('hero')}
                {!homeId ? (
                  <p className="rounded-full border border-warning/30 bg-warning/[0.06] px-3 py-1 text-[10px] text-warning">
                    Select a household to start.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-5 p-4 sm:p-6">
                {messages.map((message, index) => (
                  <div key={message.id} className={cn('flex gap-3', message.role === 'user' && 'justify-end')}>
                    {message.role === 'assistant' ? (
                      <WattbotLogo className="mt-0.5 h-7 w-7 shrink-0" />
                    ) : null}

                    <div className="max-w-[88%] space-y-2 sm:max-w-[78%]">
                      <div
                        className={cn(
                          'px-4 py-3 text-sm leading-relaxed',
                          message.role === 'user'
                            ? 'rounded-2xl rounded-br-md bg-primary text-primary-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.12)]'
                            : 'rounded-2xl rounded-bl-md border border-border/80 bg-surface',
                        )}
                      >
                        {message.role === 'assistant' ? (
                          message.content ? (
                            <Markdown text={message.content} />
                          ) : (
                            <TypingIndicator />
                          )
                        ) : (
                          message.content
                        )}
                      </div>

                      {message.role === 'assistant' && message.context ? (
                        <div className="flex flex-wrap gap-1.5">
                          <MetricChip label="Today" value={`${message.context.todayKwh.toFixed(1)} kWh`} />
                          <MetricChip label="Month" value={`${message.context.monthKwh.toFixed(1)} kWh`} />
                          {message.context.billTotal != null ? (
                            <MetricChip label="Bill est." value={`₹${message.context.billTotal.toFixed(0)}`} />
                          ) : null}
                          {message.context.simulated ? <Badge variant="warning">Simulated data</Badge> : null}
                        </div>
                      ) : null}

                      {message.role === 'assistant' && !message.streaming && message.content ? (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-[10px] text-muted-foreground">
                          <span>{time(message.createdAt)}</span>
                          {message.provider ? <span>{PROVIDER_LABEL[message.provider] ?? message.provider}</span> : null}
                          {message.fallbackReason ? <span>fallback: {message.fallbackReason}</span> : null}
                          <button
                            className="inline-flex items-center gap-1 hover:text-foreground"
                            onClick={() => {
                              void navigator.clipboard.writeText(message.content);
                              toast({ title: 'Copied', variant: 'success' });
                            }}
                          >
                            <Copy className="h-3 w-3" />
                            Copy
                          </button>
                        </div>
                      ) : null}

                      {message.role === 'user' ? (
                        <p className="pr-1 text-right text-[10px] text-muted-foreground">{time(message.createdAt)}</p>
                      ) : null}

                      {index === messages.length - 1 && message.role === 'assistant' && !message.streaming
                        ? suggestionsBlock('inline')
                        : null}
                    </div>

                    {message.role === 'user' ? (
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                        <User className="h-3.5 w-3.5" />
                      </span>
                    ) : null}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {error ? (
            <div className="flex items-center justify-between gap-3 border-t border-destructive/25 bg-destructive/[0.04] px-4 py-2 text-[11px]">
              <p className="text-destructive">{error}</p>
              {lastQuestion ? (
                <button
                  type="button"
                  className="shrink-0 font-medium text-destructive underline underline-offset-2"
                  onClick={() => void send(lastQuestion)}
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}

          <form
            className="flex shrink-0 items-end gap-2 border-t border-border/70 bg-card p-3 sm:px-4"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <Input
              autoFocus={compact}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={homeId ? 'Why is my bill higher this month?' : 'Select a household first'}
              aria-label="Message WattBot"
              disabled={!homeId || streaming || quotaBlocked}
              maxLength={2000}
              className="h-11 rounded-2xl"
            />
            <Button
              type="submit"
              size="icon"
              className="h-11 w-11 shrink-0 rounded-2xl"
              disabled={!input.trim() || streaming || !homeId || quotaBlocked}
              aria-label="Send"
            >
              <Send />
            </Button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2.5 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              {provider?.configured ? 'AI-phrased from verified facts' : 'Computed from stored readings'}
            </span>
            {quota?.included ? (
              <span>
                {quota.remainingToday} of {quota.limitPerDay} messages left today · {quota.planName}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {!compact && messages.length === 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <TriangleAlert className="h-3 w-3" />
            No SQL, no tools, no invented readings.
          </span>
          <Link to="/energy-analytics" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            Review your data instead <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function TypingIndicator() {
  return (
    <span className="flex items-center gap-1 py-1" aria-label="WattBot is typing">
      {[0, 1, 2].map((dot) => (
        <motion.span
          key={dot}
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: dot * 0.16 }}
        />
      ))}
    </span>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[10px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}
