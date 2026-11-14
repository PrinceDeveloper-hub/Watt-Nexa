import type { WattbotPage } from '@wattnexa/shared';
import { ApiError } from './api';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export interface WattbotQuota {
  planSlug: string | null;
  planName: string;
  limitPerDay: number;
  usedToday: number;
  remainingToday: number;
  resetAt: string;
  included: boolean;
}

export interface StreamMeta {
  conversationId: string;
  provider: 'none' | 'openai' | 'anthropic';
  model: string | null;
  providerConfigured: boolean;
  notice: string | null;
  suggestions: string[];
  quota?: WattbotQuota;
  context?: { todayKwh: number; monthKwh: number; simulated: boolean; billTotal?: number | null };
}

export interface StreamDone {
  messageId: string;
  conversationId: string;
  provider: string;
  model: string | null;
  fallbackReason: string | null;
  quota?: WattbotQuota;
  context?: StreamMeta['context'];
}

export interface StreamHandlers {
  onMeta?: (meta: StreamMeta) => void;
  onDelta?: (text: string) => void;
  onDone?: (done: StreamDone) => void;
}

/**
 * POST-based SSE reader. EventSource cannot send cookies + JSON body, so the
 * stream is parsed by hand. A 401 retries once through the refresh endpoint.
 */
export async function streamWattbot(
  body: { message: string; conversationId?: string; homeId: string; context?: { page?: WattbotPage } },
  handlers: StreamHandlers,
  signal?: AbortSignal,
  allowRetry = true,
): Promise<void> {
  const response = await fetch(`${BASE}/api/v1/wattbot/messages/stream?homeId=${encodeURIComponent(body.homeId)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({
      message: body.message,
      conversationId: body.conversationId,
      ...(body.context ? { context: body.context } : {}),
    }),
    signal,
  });

  if (response.status === 401 && allowRetry) {
    const refreshed = await fetch(`${BASE}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then((res) => res.ok)
      .catch(() => false);
    if (refreshed) return streamWattbot(body, handlers, signal, false);
  }

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string; code?: string } }
      | null;
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'WATTBOT_FAILED',
      payload?.error?.message ?? 'WattBot could not answer that right now.',
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');

      let event = 'message';
      const dataLines: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;

      let payload: unknown;
      try {
        payload = JSON.parse(dataLines.join('\n'));
      } catch {
        continue;
      }

      if (event === 'meta') handlers.onMeta?.(payload as StreamMeta);
      else if (event === 'delta') handlers.onDelta?.((payload as { text: string }).text);
      else if (event === 'done') handlers.onDone?.(payload as StreamDone);
      else if (event === 'error') {
        throw new ApiError(500, 'WATTBOT_FAILED', (payload as { message: string }).message);
      }
    }
  }
}
