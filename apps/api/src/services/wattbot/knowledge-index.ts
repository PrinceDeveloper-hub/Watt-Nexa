import { createHash } from 'node:crypto';
import { count, eq, isNull } from 'drizzle-orm';
import { db, wattbotKnowledgeChunks } from '@wattnexa/database';
import { env } from '../../config';
import { logger } from '../../lib/logger';
import { newId } from '../../utils/crypto';
import { chunkKnowledgeDocuments, retrieveKnowledge, type KnowledgeChunk, type KnowledgeDocument } from './knowledge';
import { cosineSimilarity, embedTexts, embeddingConfig } from './embeddings';

/**
 * Semantic retrieval index for approved product documentation.
 *
 * Text and vectors both live in MariaDB (`wattbot_knowledge_chunks`), which is
 * enough for this small, slowly changing corpus: vectors are loaded once per
 * process and scored with cosine similarity. There is deliberately no external
 * vector service or second database. If embeddings are not configured (the
 * default), retrieval stays purely lexical and needs no index at all.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const EMBED_BATCH = 16;

interface IndexedChunk extends KnowledgeDocument {
  embedding: number[] | null;
  embeddingModel: string | null;
}

interface VectorCache {
  at: number;
  model: string;
  rows: Array<{ chunk: KnowledgeChunk; vector: number[] }>;
}

let cache: VectorCache | null = null;
let bootstrap: Promise<void> | null = null;

const contentHash = (content: string) => createHash('sha256').update(content).digest('hex');

function asVector(value: unknown): number[] | null {
  // mysql2 may return a JSON column as text depending on the driver/version.
  if (typeof value === 'string') {
    try {
      return asVector(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return Array.isArray(value) && value.every((item) => typeof item === 'number') ? (value as number[]) : null;
}

/**
 * Rebuilds the approved-knowledge index. Safe to run repeatedly; unchanged
 * chunks are left alone, changed chunks are re-embedded, removed chunks are
 * deleted. Run with `pnpm --filter @wattnexa/api kb:reindex`.
 */
export async function reindexKnowledge(options: { force?: boolean } = {}): Promise<{
  chunks: number;
  embedded: number;
  removed: number;
  embedding: 'configured' | 'unavailable';
}> {
  const documents = chunkKnowledgeDocuments();
  const config = embeddingConfig();
  const existing = await db.select().from(wattbotKnowledgeChunks);
  const existingByKey = new Map(existing.map((row) => [row.chunkKey, row]));
  const documentKeys = new Set(documents.map((document) => document.key));

  const needsEmbedding = (document: KnowledgeDocument, row: (typeof existing)[number] | undefined) => {
    if (!config.configured) return false;
    if (!row) return true;
    if (!asVector(row.embedding)) return true;
    if (row.embeddingModel !== config.model) return true;
    if (options.force) return true;
    return row.contentHash !== contentHash(document.content);
  };

  const toEmbed = documents.filter((document) => needsEmbedding(document, existingByKey.get(document.key)));
  const vectors = new Map<string, number[]>();
  for (let offset = 0; offset < toEmbed.length; offset += EMBED_BATCH) {
    const batch = toEmbed.slice(offset, offset + EMBED_BATCH);
    const embedded = await embedTexts(batch.map((document) => `${document.title}\n${document.content}`));
    batch.forEach((document, index) => {
      const vector = embedded[index];
      if (vector) vectors.set(document.key, vector);
    });
  }

  let removed = 0;
  for (const row of existing) {
    if (!documentKeys.has(row.chunkKey)) {
      await db.delete(wattbotKnowledgeChunks).where(eq(wattbotKnowledgeChunks.id, row.id));
      removed += 1;
    }
  }

  for (const document of documents) {
    const row = existingByKey.get(document.key);
    const hash = contentHash(document.content);
    const vector = vectors.get(document.key);
    const contentChanged = !row || row.contentHash !== hash;

    if (!row) {
      await db.insert(wattbotKnowledgeChunks).values({
        id: newId(),
        chunkKey: document.key,
        title: document.title,
        source: document.source,
        content: document.content,
        contentHash: hash,
        embedding: vector ?? null,
        embeddingModel: vector ? config.model : null,
      });
      continue;
    }

    if (!contentChanged && !vector) continue;
    await db
      .update(wattbotKnowledgeChunks)
      .set({
        title: document.title,
        source: document.source,
        content: document.content,
        contentHash: hash,
        // A content change invalidates the old vector; leave it null until a
        // configured provider re-embeds it.
        embedding: vector ?? (contentChanged ? null : asVector(row.embedding)),
        embeddingModel: vector ? config.model : contentChanged ? null : row.embeddingModel,
        updatedAt: new Date(),
      })
      .where(eq(wattbotKnowledgeChunks.id, row.id));
  }

  cache = null;
  bootstrap = Promise.resolve();
  return {
    chunks: documents.length,
    embedded: vectors.size,
    removed,
    embedding: config.configured ? 'configured' : 'unavailable',
  };
}

async function ensureIndex(): Promise<void> {
  if (!embeddingConfig().configured) return;
  if (!bootstrap) {
    bootstrap = (async () => {
      const [total] = await db.select({ value: count() }).from(wattbotKnowledgeChunks);
      if (Number(total?.value ?? 0) === 0) {
        await reindexKnowledge();
        return;
      }
      const [missing] = await db
        .select({ value: count() })
        .from(wattbotKnowledgeChunks)
        .where(isNull(wattbotKnowledgeChunks.embedding));
      const [forModel] = await db
        .select({ value: count() })
        .from(wattbotKnowledgeChunks)
        .where(eq(wattbotKnowledgeChunks.embeddingModel, embeddingConfig().model));
      // Re-index when a chunk has no vector, or the configured embedding model
      // changed since the corpus was last indexed.
      if (
        Number(missing?.value ?? 0) > 0 ||
        Number(forModel?.value ?? 0) < Number(total?.value ?? 0)
      ) {
        await reindexKnowledge();
      }
    })().catch((error) => {
      // Allow a later request to retry (e.g. migration applied after boot).
      bootstrap = null;
      throw error;
    });
  }
  await bootstrap;
}

async function loadVectors(model: string): Promise<VectorCache['rows']> {
  if (cache && cache.model === model && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;

  const embedded = await db.select().from(wattbotKnowledgeChunks);
  const indexed: VectorCache['rows'] = [];
  for (const row of embedded) {
    if (row.embeddingModel !== model) continue;
    const vector = asVector(row.embedding);
    if (!vector) continue;
    indexed.push({
      chunk: {
        key: row.chunkKey,
        title: row.title,
        source: row.source,
        content: row.content,
      },
      vector,
    });
  }
  cache = { at: Date.now(), model, rows: indexed };
  return indexed;
}

/** Returns [] when embeddings are unavailable so the caller can fall back. */
export async function semanticRetrieve(question: string, limit = 4): Promise<KnowledgeChunk[]> {
  const config = embeddingConfig();
  if (!config.configured) return [];

  await ensureIndex();
  const [questionVector] = await embedTexts([question]);
  if (!questionVector) return [];

  const indexed = await loadVectors(config.model);
  if (indexed.length === 0) return [];

  return indexed
    .map(({ chunk, vector }) => ({ chunk, score: cosineSimilarity(questionVector, vector) }))
    .filter((result) => result.score >= env.WATTBOT_RETRIEVAL_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((result) => result.chunk);
}

/**
 * Single retrieval entry point. Semantic results are used only when the
 * provider answers and clears the relevance floor; otherwise the lexical
 * ranker answers exactly as it did before embeddings existed.
 */
export async function retrieveRelevantKnowledge(question: string, limit = 4): Promise<KnowledgeChunk[]> {
  const lexical = retrieveKnowledge(question, limit);
  if (!embeddingConfig().configured) return lexical;

  try {
    const semantic = await semanticRetrieve(question, limit);
    return semantic.length > 0 ? semantic : lexical;
  } catch (error) {
    logger.warn({ failure: (error as Error)?.name ?? 'embedding_error' }, 'Semantic retrieval unavailable; using lexical fallback');
    return lexical;
  }
}
