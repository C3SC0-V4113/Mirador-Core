import OpenAI from 'openai';

import { env } from '../../../config/env.js';
import type { EmbeddingProvider } from './embedding-provider.js';

export function createOpenAiEmbeddingProvider(): EmbeddingProvider {
  // OPENAI_API_KEY esta garantizado por el superRefine cuando EMBEDDING_PROVIDER=openai.
  // baseURL opcional: apunta al AI Gateway de Cloudflare cuando esta seteado.
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL });

  return {
    async embed(texts) {
      if (texts.length === 0) {
        return [];
      }

      const response = await client.embeddings.create({
        model: env.EMBEDDING_MODEL,
        input: texts,
      });

      // La API devuelve los embeddings en el mismo orden que la entrada.
      return response.data.map((item) => item.embedding);
    },
  };
}
