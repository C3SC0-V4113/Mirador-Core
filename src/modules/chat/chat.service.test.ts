import { describe, expect, it } from 'vitest';

import type { ReadonlyQueryResult } from '../sql-safety/readonly-query.service.js';
import type {
  ChatRepository,
  ConversationSummary,
  InsertArtifactInput,
  InsertMessageInput,
} from './chat.repositories.js';
import { handleChatMessage, type RunReadonlyQuery } from './chat.service.js';
import type { ChatHistoryMessage, LlmProvider } from './llm/llm-provider.js';
import { createStubLlmProvider } from './llm/stub-llm-provider.js';

function createFakeRepository() {
  const messages: InsertMessageInput[] = [];
  const artifacts: InsertArtifactInput[] = [];
  let messageCounter = 0;

  const repository: ChatRepository = {
    ensureConversation(_userId, conversationId) {
      return Promise.resolve(conversationId ?? 'conversation-1');
    },
    insertMessage(input) {
      messages.push(input);
      messageCounter += 1;
      return Promise.resolve({ id: `message-${String(messageCounter)}` });
    },
    insertArtifact(input) {
      artifacts.push(input);
      return Promise.resolve({ id: `artifact-${String(artifacts.length)}` });
    },
    listRecentMessages() {
      // Refleja los mensajes insertados hasta el momento (orden cronologico),
      // como lo haria la DB, para poder validar el manejo del historial.
      return Promise.resolve(
        messages.map((message) => ({ role: message.role, content: message.content })),
      );
    },
    listConversations(): Promise<ConversationSummary[]> {
      return Promise.resolve([]);
    },
  };

  return { repository, messages, artifacts };
}

const runQueryStub: RunReadonlyQuery = (sql) =>
  Promise.resolve<ReadonlyQueryResult>({
    rows: [
      { period_month: '2026-04-01', mrr: '60500.00' },
      { period_month: '2026-05-01', mrr: '62700.00' },
    ],
    sourceViews: ['ceo_revenue_summary'],
    validatedSql: sql,
  });

describe('chat orchestrator', () => {
  it('resolves a metric, runs governed SQL and persists message + artifact', async () => {
    const { repository, messages, artifacts } = createFakeRepository();

    const response = await handleChatMessage(
      { repository, llm: createStubLlmProvider(), runQuery: runQueryStub },
      {
        userId: 'user-1',
        message: '¿Cómo varió el MRR en los últimos meses?',
        traceId: 'trace-abc',
      },
    );

    expect(response.metadata.metric).toBe('mrr');
    expect(response.metadata.source_views).toEqual(['ceo_revenue_summary']);
    expect(response.metadata.validated_sql).toContain('FROM ceo_revenue_summary');
    expect(response.trace_id).toBe('trace-abc');
    expect(response.data).toHaveLength(2);
    expect(response.artifacts).toHaveLength(1);
    expect(response.suggested_questions).toHaveLength(5);

    expect(messages.map((message) => message.role)).toEqual(['USER', 'ASSISTANT']);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.traceId).toBe('trace-abc');
  });

  it('falls back to a clarification when no catalog metric matches', async () => {
    const { repository, artifacts } = createFakeRepository();

    const response = await handleChatMessage(
      { repository, llm: createStubLlmProvider(), runQuery: runQueryStub },
      {
        userId: 'user-1',
        message: 'cuéntame un chiste sobre logística',
        traceId: 'trace-xyz',
      },
    );

    expect(response.metadata.metric).toBeNull();
    expect(response.warnings).toContain('metric_not_resolved');
    expect(artifacts[0]?.artifactType).toBe('TEXT');
  });

  it('surfaces a specific clarification message from the planner', async () => {
    const { repository } = createFakeRepository();
    const specific = 'Puedo darte ingresos por mes, pero aún no comparo contra el mejor mes.';

    const llm: LlmProvider = {
      planMetricQuery: () => Promise.resolve({ kind: 'clarify', message: specific }),
      composeNarrative: () => Promise.resolve(''),
    };

    const response = await handleChatMessage(
      { repository, llm, runQuery: runQueryStub },
      { userId: 'user-1', message: 'ventas vs mejor mes', traceId: 'trace-clarify' },
    );

    expect(response.metadata.metric).toBeNull();
    expect(response.message).toBe(specific);
    expect(response.artifacts[0]?.summary).toBe(specific);
  });

  it('returns a conversational reply without warnings', async () => {
    const { repository, artifacts } = createFakeRepository();
    const greeting = '¡Hola! ¿En qué puedo ayudarte hoy?';

    const llm: LlmProvider = {
      planMetricQuery: () => Promise.resolve({ kind: 'conversational', message: greeting }),
      composeNarrative: () => Promise.resolve(''),
    };

    const response = await handleChatMessage(
      { repository, llm, runQuery: runQueryStub },
      { userId: 'user-1', message: 'hola', traceId: 'trace-greet' },
    );

    expect(response.metadata.metric).toBeNull();
    expect(response.message).toBe(greeting);
    expect(response.warnings).toEqual([]);
    expect(artifacts[0]?.artifactType).toBe('TEXT');
    expect(artifacts[0]?.payload).toMatchObject({ conversational: true });
  });

  it('passes prior turns as history without duplicating the current message', async () => {
    const { repository } = createFakeRepository();

    await repository.insertMessage({
      conversationId: 'conversation-1',
      role: 'USER',
      content: 'hola',
      intentMode: null,
      traceId: 'trace-0',
    });
    await repository.insertMessage({
      conversationId: 'conversation-1',
      role: 'ASSISTANT',
      content: '¡Hola! ¿En qué te ayudo?',
      intentMode: null,
      traceId: 'trace-0',
    });

    let capturedHistory: ChatHistoryMessage[] | undefined;
    const llm: LlmProvider = {
      planMetricQuery: (_prompt, _catalog, _temporal, history) => {
        capturedHistory = history;
        return Promise.resolve({ kind: 'conversational', message: 'De nada.' });
      },
      composeNarrative: () => Promise.resolve(''),
    };

    await handleChatMessage(
      { repository, llm, runQuery: runQueryStub },
      {
        userId: 'user-1',
        conversationId: 'conversation-1',
        message: 'gracias',
        traceId: 'trace-1',
      },
    );

    expect(capturedHistory).toEqual([
      { role: 'USER', content: 'hola' },
      { role: 'ASSISTANT', content: '¡Hola! ¿En qué te ayudo?' },
    ]);
    expect(capturedHistory?.some((message) => message.content === 'gracias')).toBe(false);
  });
});
