import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Copy, Menu, Plus, Send, Sparkles, Trash2, TriangleAlert, User, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Markdown } from '@/components/markdown';
import { PageHeader } from '@/components/common';
import { Badge, Skeleton } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/forms';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useHomes } from '@/lib/hooks';
import { streamWattbot, type StreamMeta, type WattbotQuota } from '@/lib/wattbot-stream';
import { cn } from '@/lib/utils';
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
}: {
  compact?: boolean;
  initialPrompt?: string;
  initialPromptId?: number;
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
    queryKey: ['wattbot', 'suggestions', homeId],
    queryFn: () => api.get<string[]>(`/wattbot/suggestions?homeId=${homeId}`),
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
        { message: text, conversationId: conversationId ?? undefined, homeId },
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
  const sidebar = (
    <div className="flex h-full flex-col gap-3">
      <Button variant="outline" className="w-full justify-start" onClick={reset}>
        <Plus />
        New conversation
      </Button>

      <div className="flex-1 space-y-1 overflow-y-auto">
        {conversations.isLoading ? <Skeleton className="h-16" /> : null}
        {(conversations.data ?? []).map((conversation) => (
          <div key={conversation.id} className="group flex items-center gap-1">
            <button
              onClick={() => void openConversation(conversation.id)}
              className={cn(
                'min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted',
                conversationId === conversation.id ? 'bg-muted font-medium' : 'text-muted-foreground',
              )}
              title={conversation.title}
            >
              {conversation.title}
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 focus:opacity-100 group-hover:opacity-100"
              onClick={() => deleteConversation.mutate(conversation.id)}
              aria-label={`Delete ${conversation.title}`}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
        {conversations.data?.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-muted-foreground">No conversations yet.</p>
        ) : null}
      </div>

      {series.data && series.data.length > 0 ? (
        <div className="rounded-lg border border-border p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Last 7 days</p>
          <div className="mt-2 flex h-16 items-end gap-1">
            {series.data.map((point) => {
              const max = Math.max(...series.data!.map((item) => item.energyKwh), 1);
              return (
                <div
                  key={point.timestamp}
                  className="flex-1 rounded-sm bg-primary/70"
                  style={{ height: `${Math.max(4, (point.energyKwh / max) * 100)}%` }}
                  title={`${point.timestamp.slice(0, 10)}: ${point.energyKwh.toFixed(1)} kWh`}
                />
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">Measured totals per day.</p>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className={compact ? 'flex h-full min-h-0 flex-col gap-2' : 'space-y-4'}>
      {!compact ? (
        <PageHeader
          title="WattBot"
          description="Answers grounded in your own readings, tariff and device state."
          actions={
          <>
            <Badge variant={provider?.configured ? 'neutral' : 'outline'}>
              <Sparkles className="h-3 w-3" />
              {provider?.configured ? `AI: ${provider.provider}` : 'Data analysis mode'}
            </Badge>
            <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu />
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
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            {provider.reason} Answers are computed directly from your stored readings and tariff — no text is sent to
            an external AI provider.
          </p>
        </div>
      ) : null}

      {quota && !quota.included ? (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            WattBot is part of the <strong>Plus</strong> and <strong>Pro</strong> plans. You are on{' '}
            <strong>{quota.planName}</strong>, which does not include it.
          </p>
          <Button asChild size="sm" variant="outline">
            <Link to="/app/billing">Compare plans</Link>
          </Button>
        </div>
      ) : null}

      {quota?.included && quota.remainingToday <= 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
          Daily limit reached — {quota.usedToday} of {quota.limitPerDay} messages used. Resets{' '}
          {new Date(quota.resetAt).toLocaleString()}.
        </div>
      ) : null}

      <div className={cn('grid gap-4', compact ? 'min-h-0 flex-1 grid-cols-1' : 'lg:grid-cols-[240px_1fr]')}>
        {!compact ? <Card className="hidden p-3 lg:block">{sidebar}</Card> : null}

        <AnimatePresence>
          {sidebarOpen ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 lg:hidden"
            >
              <button
                className="absolute inset-0 bg-black/60"
                aria-label="Close history"
                onClick={() => setSidebarOpen(false)}
              />
              <motion.div
                initial={{ x: -280 }}
                animate={{ x: 0 }}
                exit={{ x: -280 }}
                transition={{ type: 'tween', duration: 0.2 }}
                className="absolute inset-y-0 left-0 w-72 border-r border-border bg-surface p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold">Conversations</p>
                  <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} aria-label="Close">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {sidebar}
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <Card className={cn('flex min-h-0 flex-col p-0', compact ? 'h-full' : 'h-[calc(100vh-15rem)] min-h-[460px]')}>
          <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <WattbotLogo className="h-12 w-12" />
                <div>
                  <p className="text-sm font-semibold">Ask about your own electricity</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                    I only see this household. If a number is not in your readings, I will say so instead of guessing.
                  </p>
                </div>
                <div className="flex max-w-lg flex-wrap justify-center gap-2">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => void send(suggestion)}
                      className="rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message, index) => (
                <div key={message.id} className={cn('flex gap-2.5', message.role === 'user' && 'justify-end')}>
                  {message.role === 'assistant' ? (
                    <WattbotLogo className="mt-0.5 h-7 w-7 shrink-0" />
                  ) : null}

                  <div className={cn('max-w-[88%] space-y-2 sm:max-w-[80%]')}>
                    <div
                      className={cn(
                        'rounded-2xl px-4 py-2.5',
                        message.role === 'user'
                          ? 'rounded-br-sm bg-primary text-sm text-primary-foreground'
                          : 'rounded-bl-sm border border-border bg-surface',
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
                      <div className="flex items-center gap-3 pl-1 text-[10px] text-muted-foreground">
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

                    {index === messages.length - 1 && message.role === 'assistant' && !message.streaming && suggestions.length ? (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {suggestions.slice(0, 3).map((suggestion) => (
                          <button
                            key={suggestion}
                            onClick={() => void send(suggestion)}
                            className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {message.role === 'user' ? (
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                      <User className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {error ? (
            <div className="flex items-center justify-between gap-3 border-t border-destructive/30 bg-destructive/5 px-4 py-2 text-xs">
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
            className="flex gap-2 border-t border-border p-3"
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
            />
            <Button type="submit" size="icon" disabled={!input.trim() || streaming || !homeId || quotaBlocked} aria-label="Send">
              <Send />
            </Button>
          </form>

          {quota?.included ? (
            <p className="px-4 pb-2 text-[10px] text-muted-foreground">
              {quota.remainingToday} of {quota.limitPerDay} messages left today on the {quota.planName} plan.
            </p>
          ) : null}
        </Card>
      </div>
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
    <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}
