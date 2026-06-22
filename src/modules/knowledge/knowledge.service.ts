import type { LlmProvider } from '../chat/llm/llm-provider.js';
import type { EmbeddingProvider } from './embeddings/embedding-provider.js';
import type { KnowledgeChunk, KnowledgeRepository } from './knowledge.repositories.js';

const TOP_K = 5;
// Umbral de similitud coseno por debajo del cual no consideramos que el chunk
// fundamente la respuesta (evita responder con ruido).
const MIN_SCORE = 0.2;

const NO_EVIDENCE_MESSAGE =
  'No encontré evidencia documental para responder eso. ¿Puedes reformularlo o consultar una métrica del negocio?';

export type Citation = { document_id: string; title: string; locator: string };

export type KnowledgeAnswer = {
  message: string;
  citations: Citation[];
  documentIds: string[];
  hasEvidence: boolean;
};

export type KnowledgeServiceDeps = {
  knowledge: KnowledgeRepository;
  embeddings: EmbeddingProvider;
  llm: LlmProvider;
};

export async function answerFromKnowledge(
  deps: KnowledgeServiceDeps,
  input: { question: string; accessScope: string },
): Promise<KnowledgeAnswer> {
  const queryEmbeddings = await deps.embeddings.embed([input.question]);

  if (queryEmbeddings.length === 0) {
    return noEvidence();
  }

  const chunks = await deps.knowledge.searchChunks(queryEmbeddings[0], {
    topK: TOP_K,
    accessScope: input.accessScope,
  });
  const relevant = chunks.filter((chunk) => chunk.score >= MIN_SCORE);

  if (relevant.length === 0) {
    return noEvidence();
  }

  const message = await deps.llm.composeKnowledgeAnswer({
    question: input.question,
    chunks: relevant.map((chunk) => ({
      title: chunk.title,
      locator: chunk.locator,
      content: chunk.content,
    })),
  });

  return {
    message,
    citations: dedupeCitations(relevant),
    documentIds: [...new Set(relevant.map((chunk) => chunk.documentId))],
    hasEvidence: true,
  };
}

function noEvidence(): KnowledgeAnswer {
  return { message: NO_EVIDENCE_MESSAGE, citations: [], documentIds: [], hasEvidence: false };
}

function dedupeCitations(chunks: KnowledgeChunk[]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];

  for (const chunk of chunks) {
    const key = `${chunk.documentId}|${chunk.locator}`;
    if (!seen.has(key)) {
      seen.add(key);
      citations.push({ document_id: chunk.documentId, title: chunk.title, locator: chunk.locator });
    }
  }

  return citations;
}
