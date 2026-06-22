import { env } from '../../../config/env.js';
import { createOpenAiEmbeddingProvider } from './openai-embedding-provider.js';
import { createStubEmbeddingProvider } from './stub-embedding-provider.js';

// Dimension de text-embedding-3-small. El stub produce vectores del mismo tamano
// para que el esquema vector(1536) y el retrieval funcionen sin red.
export const EMBEDDING_DIMENSIONS = 1536;

export type EmbeddingProvider = {
  embed(texts: string[]): Promise<number[][]>;
};

export function createEmbeddingProvider(): EmbeddingProvider {
  if (env.EMBEDDING_PROVIDER === 'openai') {
    return createOpenAiEmbeddingProvider();
  }

  return createStubEmbeddingProvider();
}
