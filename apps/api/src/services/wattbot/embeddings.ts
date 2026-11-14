import { env } from '../../config';

/**
 * Optional embedding provider for semantic product-knowledge retrieval.
 * When it is not configured the assistant falls back to lexical retrieval, so
 * no key is required for WattBot to work.
 */
export interface EmbeddingConfig {
  provider: 'none' | 'openai';
  model: string;
  configured: boolean;
}

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

export function embeddingConfig(): EmbeddingConfig {
  const provider = env.WATTBOT_EMBEDDING_PROVIDER;
  const configured = provider === 'openai' && Boolean(env.OPENAI_API_KEY);
  return {
    provider,
    model: env.WATTBOT_EMBEDDING_MODEL,
    configured,
  };
}

const endpoint = () =>
  `${(env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/embeddings`;

/** Batched embedding call with the same hard timeout as chat completions. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const config = embeddingConfig();
  if (!config.configured) throw new EmbeddingError('Embedding provider is not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.WATTBOT_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: config.model, input: texts }),
    });
    if (!response.ok) throw new EmbeddingError(`Embedding provider responded ${response.status}`);

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };
    const rows = [...(payload.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (rows.length !== texts.length) throw new EmbeddingError('Embedding response count did not match input');

    return rows.map((row) => {
      if (!Array.isArray(row.embedding) || row.embedding.length === 0) {
        throw new EmbeddingError('Embedding response contained an empty vector');
      }
      return row.embedding;
    });
  } finally {
    clearTimeout(timer);
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
