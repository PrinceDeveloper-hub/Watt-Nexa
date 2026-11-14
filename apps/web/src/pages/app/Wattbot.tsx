import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Send, Sparkles, Trash2, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/common';
import { Badge, Skeleton } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/forms';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useHomes } from '@/lib/hooks';

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  provider?: string;
}

export function Wattbot() {
  const { homeId } = useHomes();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const conversations = useQuery({
    queryKey: ['wattbot', 'conversations'],
    queryFn: () => api.get<ConversationSummary[]>('/wattbot/conversations'),
  });

  const suggestions = useQuery({
    queryKey: ['wattbot', 'suggestions'],
    queryFn: () => api.get<string[]>('/wattbot/suggestions'),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const sand = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setInput('');
    const optimistic: Message = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);

    try {
      const result = await api.post<{ conversationId: string; reply: string; provider: string }>(
        `/wattbot/messages?homeId=${homeId}`,
        { message: trimmed, conversationId: conversationId ?? undefined },
      );
      setConversationId(result.conversationId);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.reply,
          createdAt: new Date().toISOString(),
          provider: result.provider,
        },
      ]);
      await queryClient.invalidateQueries({ queryKey: ['wattbot', 'conversations'] });
    } catch (error) {
      toast({
        title: 'WattBot could not answer',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    }
  };

  const clearMutation = useMutation({
    mutationFn: (id: string) => api.del(`/wattbot/conversations/${id}`),
    onSuccess: async () => {
      setMessages([]);
      setConversationId(null);
      await queryClient.invalidateQueries({ queryKey: ['wattbot', 'conversations'] });
    },
  });

  const loadConversation = async (id: string) => {
    const result = await api.get<{ messages: Message[] }>(`/wattbot/conversations/${id}`);
    setConversationId(id);
    setMessages(result.messages);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="WattBot"
        description="Answers grounded in your own readings and tariff."
        actions={
          <>
            <Badge variant="outline">
              <Sparkles className="h-3 w-3" /> Rule-based fallback when no AI provider is configured
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setMessages([]);
                setConversationId(null);
              }}
            >
              New chat
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="p-3 lg:col-span-1">
          <p className="px-2 pb-2 text-xs font-semibold text-muted-foreground">History</p>
          {conversations.isLoading ? <Skeleton className="h-20" /> : null}
          <div className="space-y-1">
            {(conversations.data ?? []).map((conversation) => (
              <div key={conversation.id} className="group flex items-center gap-1">
                <button
                  onClick={() => void loadConversation(conversation.id)}
                  className={`flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted ${
                    conversationId === conversation.id ? 'bg-muted font-medium' : 'text-muted-foreground'
                  }`}
                >
                  {conversation.title}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100"
                  onClick={() => clearMutation.mutate(conversation.id)}
                  aria-label="Delete conversation"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {conversations.data?.length === 0 ? (
              <p className="px-2 py-3 text-[11px] text-muted-foreground">No conversations yet.</p>
            ) : null}
          </div>
        </Card>

        <Card className="flex h-[calc(100vh-16rem)] min-h-[420px] flex-col lg:col-span-3">
          <div className="flex-1 space-y-4 overflow-y-auto p-5 scrollbar-thin">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/12">
                  <Bot className="h-6 w-6 text-primary" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Ask about your own electricity</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    WattBot only sees your household. It will not invent readings.
                  </p>
                </div>
                <div className="flex max-w-md flex-wrap justify-center gap-2">
                  {(suggestions.data ?? []).map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => void sand(suggestion)}
                      className="rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-2.5 ${message.role === 'user' ? 'justify-end' : ''}`}
                >
                  {message.role === 'assistant' ? (
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/12">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </span>
                  ) : null}
                  <div
                    className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      message.role === 'user'
                        ? 'rounded-br-sm bg-primary text-primary-foreground'
                        : 'rounded-bl-sm border border-border bg-surface'
                    }`}
                  >
                    {message.content}
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

          <form
            className="flex gap-2 border-t border-border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void sand(input);
            }}
          >
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Why is my bill higher this month?"
              aria-label="Message WattBot"
            />
            <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Send">
              <Send />
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
