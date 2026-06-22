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

export type KnowledgeChunkRef = { title: string; locator: string; content: string };

export type KnowledgeRetrieval = {
  chunks: KnowledgeChunkRef[];
  citations: Citation[];
  documentIds: string[];
  hasEvidence: boolean;
};

export type KnowledgeRetrievalDeps = {
  knowledge: KnowledgeRepository;
  embeddings: EmbeddingProvider;
};

export type KnowledgeServiceDeps = KnowledgeRetrievalDeps & {
  llm: LlmProvider;
};

// Solo recuperacion (embed + busqueda vectorial), sin sintesis. Lo reusa el camino
// documental puro y el combinado (metrica + conocimiento), que sintetiza una vez.
export async function retrieveKnowledge(
  deps: KnowledgeRetrievalDeps,
  input: { question: string; accessScope: string },
): Promise<KnowledgeRetrieval> {
  const queryEmbeddings = await deps.embeddings.embed([input.question]);

  if (queryEmbeddings.length === 0) {
    return { chunks: [], citations: [], documentIds: [], hasEvidence: false };
  }

  const found = await deps.knowledge.searchChunks(queryEmbeddings[0], {
    topK: TOP_K,
    accessScope: input.accessScope,
  });
  const relevant = found.filter((chunk) => chunk.score >= MIN_SCORE);

  return {
    chunks: relevant.map((chunk) => ({
      title: chunk.title,
      locator: chunk.locator,
      content: chunk.content,
    })),
    citations: dedupeCitations(relevant),
    documentIds: [...new Set(relevant.map((chunk) => chunk.documentId))],
    hasEvidence: relevant.length > 0,
  };
}

export async function answerFromKnowledge(
  deps: KnowledgeServiceDeps,
  input: { question: string; accessScope: string },
): Promise<KnowledgeAnswer> {
  const retrieval = await retrieveKnowledge(deps, input);

  if (!retrieval.hasEvidence) {
    return { message: NO_EVIDENCE_MESSAGE, citations: [], documentIds: [], hasEvidence: false };
  }

  const message = await deps.llm.composeKnowledgeAnswer({
    question: input.question,
    chunks: retrieval.chunks,
  });

  return {
    message,
    citations: retrieval.citations,
    documentIds: retrieval.documentIds,
    hasEvidence: true,
  };
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
