import { createHash } from 'node:crypto';

import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from './embedding-provider.js';

// Embedding determinista sin red para tests y arranque sin key. El mismo texto
// produce el mismo vector (1536 dims); no es semantico, solo estable.
export function createStubEmbeddingProvider(): EmbeddingProvider {
  return {
    embed(texts) {
      return Promise.resolve(texts.map(embedOne));
    },
  };
}

function embedOne(text: string): number[] {
  const hash = createHash('sha256').update(text).digest();
  // LCG sembrado por el hash del texto: rellena el vector de forma determinista.
  let state = hash.readUInt32BE(0) || 1;
  const vector: number[] = [];

  for (let index = 0; index < EMBEDDING_DIMENSIONS; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    vector.push((state / 0xffffffff) * 2 - 1);
  }

  return vector;
}
