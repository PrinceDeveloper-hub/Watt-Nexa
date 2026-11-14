import { env } from '../../config';
import { logger } from '../../lib/logger';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  signal: AbortSignal;
  maxTokens: number;
  temperature: number;
}

export type ProviderFailure = 'timeout' | 'rate_limited' | 'unavailable' | 'empty_response';

/** Safe to surface as a fallback reason; never contains provider payloads. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: ProviderFailure,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface AiProvider {
  readonly id: 'openai' | 'anthropic';
  readonly model: string;
  complete(messages: ChatMessage[], options: CompletionOptions): Promise<string>;
  /** Resolves with the full text; calls onDelta for each token chunk. */
  stream(messages: ChatMessage[], options: CompletionOptions, onDelta: (text: string) => void): Promise<string>;
}

const statusToFailure = (status: number): ProviderFailure =>
  status === 429 ? 'rate_limited' : 'unavailable';

/** Base URLs are configurable so a gateway or the local mock can stand in. */
const openaiEndpoint = `${(env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`;
const anthropicEndpoint = `${(env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1').replace(/\/$/, '')}/messages`;

/** Reads an SSE body and forwards `delta` text from each JSON frame. */
async function readEventStream(
  body: ReadableStream<Uint8Array>,
  extract: (payload: unknown) => string | null,
  onDelta: (text: string) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let index = buffer.indexOf('\n\n');
    while (index !== -1) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      index = buffer.indexOf('\n\n');

      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const text = extract(JSON.parse(raw));
          if (text) {
            full += text;
            onDelta(text);
          }
        } catch {
          // A malformed frame is skipped; the final content is still validated.
          logger.debug('Skipping unparseable provider stream frame');
        }
      }
    }
  }

  return full;
}

const openaiProvider: AiProvider = {
  id: 'openai',
  model: env.OPENAI_MODEL,
  async complete(messages, { signal, maxTokens, temperature }) {
    const response = await fetch(openaiEndpoint, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: env.OPENAI_MODEL, messages, temperature, max_tokens: maxTokens }),
    });
    if (!response.ok) throw new ProviderError(`OpenAI responded ${response.status}`, statusToFailure(response.status));
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  },
  async stream(messages, options, onDelta) {
    const response = await fetch(openaiEndpoint, {
      method: 'POST',
      signal: options.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: true,
      }),
    });
    if (!response.ok || !response.body) {
      throw new ProviderError(`OpenAI responded ${response.status}`, statusToFailure(response.status));
    }
    return readEventStream(
      response.body,
      (payload) => (payload as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content ?? null,
      onDelta,
    );
  },
};

const anthropicProvider: AiProvider = {
  id: 'anthropic',
  model: env.ANTHROPIC_MODEL,
  async complete(messages, { signal, maxTokens, temperature }) {
    const system = messages.find((message) => message.role === 'system')?.content ?? '';
    const rest = messages.filter((message) => message.role !== 'system');
    const response = await fetch(anthropicEndpoint, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: env.ANTHROPIC_MODEL, system, messages: rest, temperature, max_tokens: maxTokens }),
    });
    if (!response.ok) throw new ProviderError(`Anthropic responded ${response.status}`, statusToFailure(response.status));
    const data = (await response.json()) as { content?: Array<{ text?: string }> };
    return data.content?.map((part) => part.text ?? '').join('') ?? '';
  },
  async stream(messages, options, onDelta) {
    const system = messages.find((message) => message.role === 'system')?.content ?? '';
    const rest = messages.filter((message) => message.role !== 'system');
    const response = await fetch(anthropicEndpoint, {
      method: 'POST',
      signal: options.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL,
        system,
        messages: rest,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: true,
      }),
    });
    if (!response.ok || !response.body) {
      throw new ProviderError(`Anthropic responded ${response.status}`, statusToFailure(response.status));
    }
    return readEventStream(
      response.body,
      (payload) => {
        const frame = payload as { type?: string; delta?: { type?: string; text?: string } };
        return frame.type === 'content_block_delta' && frame.delta?.type === 'text_delta'
          ? (frame.delta.text ?? null)
          : null;
      },
      onDelta,
    );
  },
};

const providers: Record<'openai' | 'anthropic', { provider: AiProvider; configured: boolean }> = {
  openai: { provider: openaiProvider, configured: Boolean(env.OPENAI_API_KEY) },
  anthropic: { provider: anthropicProvider, configured: Boolean(env.ANTHROPIC_API_KEY) },
};

export interface ProviderStatus {
  provider: 'none' | 'openai' | 'anthropic';
  model: string | null;
  configured: boolean;
  /** Why WattBot would answer from data alone. */
  reason: string | null;
}

export function providerStatus(): ProviderStatus {
  const preferred = env.WATTBOT_PROVIDER;
  if (preferred === 'none') {
    return {
      provider: 'none',
      model: null,
      configured: false,
      reason: 'No AI provider is configured; WattBot answers from your data using deterministic rules.',
    };
  }
  const entry = providers[preferred];
  if (!entry.configured) {
    return {
      provider: preferred,
      model: null,
      configured: false,
      reason: `${preferred} is selected but its API key is missing; WattBot answers from your data using deterministic rules.`,
    };
  }
  return { provider: preferred, model: entry.provider.model, configured: true, reason: null };
}

export function resolveProvider(): AiProvider | null {
  const status = providerStatus();
  if (!status.configured) return null;
  return providers[env.WATTBOT_PROVIDER as 'openai' | 'anthropic'].provider;
}
