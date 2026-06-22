import { describe, expect, it } from 'vitest';

import type { LlmProvider } from '../chat/llm/llm-provider.js';
import { createStubEmbeddingProvider } from './embeddings/stub-embedding-provider.js';
import type { KnowledgeChunk, KnowledgeRepository } from './knowledge.repositories.js';
import { answerFromKnowledge, type KnowledgeServiceDeps } from './knowledge.service.js';

function fakeKnowledge(chunks: KnowledgeChunk[]): KnowledgeRepository {
  return {
    searchChunks: () => Promise.resolve(chunks),
    listKnowledgeBase: () => Promise.resolve([]),
    insertDocumentWithChunks: () => Promise.resolve('doc'),
  };
}

const fakeLlm = {
  composeKnowledgeAnswer: (input: { chunks: { title: string }[] }) =>
    Promise.resolve(`respuesta basada en (${input.chunks[0]?.title ?? '-'})`),
} as unknown as LlmProvider;

function deps(chunks: KnowledgeChunk[]): KnowledgeServiceDeps {
  return {
    knowledge: fakeKnowledge(chunks),
    embeddings: createStubEmbeddingProvider(),
    llm: fakeLlm,
  };
}

describe('knowledge service', () => {
  it('answers with deduped citations when relevant chunks exist', async () => {
    const chunks: KnowledgeChunk[] = [
      {
        content: 'Las fechas se acuerdan...',
        locator: 'Compromiso de fechas',
        documentId: 'doc-1',
        title: 'Política de Delivery',
        score: 0.82,
      },
      {
        content: 'Un proyecto se marca en riesgo...',
        locator: 'Escalamiento de riesgo',
        documentId: 'doc-1',
        title: 'Política de Delivery',
        score: 0.6,
      },
    ];

    const result = await answerFromKnowledge(deps(chunks), {
      question: '¿cuál es la política de delivery?',
      accessScope: 'CEO',
    });

    expect(result.hasEvidence).toBe(true);
    expect(result.message).toContain('Política de Delivery');
    expect(result.citations).toHaveLength(2);
    expect(result.documentIds).toEqual(['doc-1']);
  });

  it('returns no-evidence when no chunk passes the similarity threshold', async () => {
    const chunks: KnowledgeChunk[] = [
      { content: 'ruido', locator: 'x', documentId: 'doc-9', title: 'Otro', score: 0.05 },
    ];

    const result = await answerFromKnowledge(deps(chunks), {
      question: 'algo',
      accessScope: 'CEO',
    });

    expect(result.hasEvidence).toBe(false);
    expect(result.citations).toEqual([]);
    expect(result.documentIds).toEqual([]);
  });

  it('returns no-evidence when the knowledge base is empty', async () => {
    const result = await answerFromKnowledge(deps([]), { question: 'algo', accessScope: 'CEO' });

    expect(result.hasEvidence).toBe(false);
  });
});

describe('stub embedding provider', () => {
  it('is deterministic and 1536-dimensional', async () => {
    const provider = createStubEmbeddingProvider();
    const [a] = await provider.embed(['política de delivery']);
    const [b] = await provider.embed(['política de delivery']);
    const [c] = await provider.embed(['otra cosa']);

    expect(a).toHaveLength(1536);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
