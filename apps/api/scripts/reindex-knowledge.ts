import { closeDatabase } from '@wattnexa/database';
import { reindexKnowledge } from '../src/services/wattbot/knowledge-index';
import { embeddingConfig } from '../src/services/wattbot/embeddings';

/**
 * Rebuilds the approved WattBot knowledge index in MariaDB.
 * Run after editing `services/wattbot/knowledge.ts` or changing the embedding
 * model. Without an embedding provider this refreshes the stored text and the
 * assistant continues to use lexical retrieval.
 */
async function main() {
  const config = embeddingConfig();
  console.log(
    config.configured
      ? `Indexing with ${config.provider}/${config.model}…`
      : 'No embedding provider configured; storing text for lexical retrieval only.',
  );

  const result = await reindexKnowledge({ force: true });
  console.log(
    `✓ ${result.chunks} chunks indexed, ${result.embedded} embedded, ${result.removed} removed (embedding: ${result.embedding})`,
  );
}

main()
  .catch((error) => {
    console.error('✗ Knowledge re-index failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
