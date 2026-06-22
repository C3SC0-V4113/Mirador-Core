import { describe, expect, it } from 'vitest';

import type { ReadonlyQueryResult } from '../sql-safety/readonly-query.service.js';
import type {
  ArtifactRecord,
  ChatRepository,
  ConversationDetail,
  ConversationSummary,
  InsertArtifactInput,
  InsertMessageInput,
} from './chat.repositories.js';
import {
  editArtifactVisualization,
  getConversationDetail,
  handleChatMessage,
  renameConversation,
  type RunReadonlyQuery,
} from './chat.service.js';
import type { ChatHistoryMessage, LlmProvider } from './llm/llm-provider.js';
import { createStubLlmProvider } from './llm/stub-llm-provider.js';
import type { AuditLogInput, AuditRepository } from '../audit/audit.repositories.js';

function createFakeAudit() {
  const rows: AuditLogInput[] = [];
  const audit: AuditRepository = {
    insertAuditLog: (input) => {
      rows.push(input);
      return Promise.resolve();
    },
  };
  return { audit, rows };
}

function makeLlm(overrides: Partial<LlmProvider>): LlmProvider {
  return {
    planMetricQuery: () => Promise.resolve({ kind: 'clarify', message: '' }),
    composeNarrative: () => Promise.resolve(''),
    composePlan: () => Promise.resolve([]),
    suggestFollowUps: () => Promise.resolve([]),
    editChartSpec: () => Promise.resolve({ kind: 'route_to_main', reason: '' }),
    generateFallbackSql: () => Promise.resolve(null),
    ...overrides,
  };
}

function createFakeRepository() {
  const messages: InsertMessageInput[] = [];
  const artifacts: InsertArtifactInput[] = [];
  const artifactStore = new Map<string, { record: ArtifactRecord; userId: string }>();
  const conversationDetails = new Map<string, { detail: ConversationDetail; userId: string }>();
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
      return Promise.resolve(
        messages.map((message) => ({ role: message.role, content: message.content })),
      );
    },
    listConversations(): Promise<ConversationSummary[]> {
      return Promise.resolve([]);
    },
    getConversationDetail(conversationId, userId) {
      const entry = conversationDetails.get(conversationId);
      return Promise.resolve(entry?.userId === userId ? entry.detail : null);
    },
    renameConversation(conversationId, userId, title) {
      const entry = conversationDetails.get(conversationId);

      if (entry?.userId !== userId) {
        return Promise.resolve(false);
      }

      entry.detail = { ...entry.detail, title };
      return Promise.resolve(true);
    },
    getArtifactForUser(artifactId, userId) {
      const entry = artifactStore.get(artifactId);
      return Promise.resolve(entry?.userId === userId ? entry.record : null);
    },
    updateArtifactChartSpec(artifactId, chartSpec) {
      const entry = artifactStore.get(artifactId);
      if (entry !== undefined) {
        entry.record = { ...entry.record, chartSpec };
      }
      return Promise.resolve();
    },
  };

  return { repository, messages, artifacts, artifactStore, conversationDetails };
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
    // Sugerencias dinámicas (stub): contextuales a la métrica resuelta.
    expect(response.suggested_questions).toHaveLength(3);
    expect(response.suggested_questions[0]).toContain('MRR');

    expect(messages.map((message) => message.role)).toEqual(['USER', 'ASSISTANT']);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.traceId).toBe('trace-abc');
  });

  it('feeds the full metric catalog (not just labels) to follow-up suggestions', async () => {
    const { repository } = createFakeRepository();
    let captured: Parameters<LlmProvider['suggestFollowUps']>[0] | undefined;
    const llm: LlmProvider = {
      ...createStubLlmProvider(),
      suggestFollowUps: (input) => {
        captured = input;
        return Promise.resolve(['¿Cuál es el MRR actual?']);
      },
    };

    const response = await handleChatMessage(
      { repository, llm, runQuery: runQueryStub },
      { userId: 'user-1', message: '¿Cómo varió el MRR?', traceId: 'trace-cat' },
    );

    expect(response.suggested_questions).toEqual(['¿Cuál es el MRR actual?']);
    // The suggester gets the rich catalog so it only proposes answerable questions.
    expect(captured?.catalogContext.metrics.length ?? 0).toBeGreaterThan(0);
    expect(captured?.catalogContext.metrics[0]).toHaveProperty('dimensions');
    expect(captured?.catalogContext.metrics[0]).toHaveProperty('filters_allowed');
  });

  it('sets the chart x-axis to the queried dimension (not the time column)', async () => {
    const { repository } = createFakeRepository();
    const llm = makeLlm({
      planMetricQuery: () =>
        Promise.resolve({
          kind: 'metric',
          query: { metric: 'customer_revenue', dimensions: ['segment'] },
        }),
      composeNarrative: () => Promise.resolve('Ingresos por segmento.'),
    });
    const runQuery: RunReadonlyQuery = (sql) =>
      Promise.resolve({
        rows: [
          { segment: 'Enterprise', revenue: '1000' },
          { segment: 'SMB', revenue: '500' },
        ],
        sourceViews: ['ceo_customer_revenue_summary'],
        validatedSql: sql,
      });

    const response = await handleChatMessage(
      { repository, llm, runQuery },
      { userId: 'user-1', message: 'ingresos por segmento', traceId: 'trace-dim' },
    );

    expect(response.artifacts[0]?.type).toBe('CHART');
    expect(response.chart).toMatchObject({ x: 'segment', y: 'revenue' });
  });

  it('downgrades to a TABLE when the chart columns are absent from the rows', async () => {
    const { repository } = createFakeRepository();
    const llm = makeLlm({
      planMetricQuery: () =>
        Promise.resolve({
          kind: 'metric',
          query: { metric: 'customer_revenue', dimensions: ['segment'] },
        }),
      composeNarrative: () => Promise.resolve('No hay datos de ingresos por segmento.'),
    });
    // Rows lack `segment`/`revenue` → the chart is not renderable.
    const runQuery: RunReadonlyQuery = (sql) =>
      Promise.resolve({
        rows: [{ health_score: 80 }, { health_score: 60 }],
        sourceViews: ['ceo_customer_revenue_summary'],
        validatedSql: sql,
      });

    const response = await handleChatMessage(
      { repository, llm, runQuery },
      { userId: 'user-1', message: 'ingresos por segmento', traceId: 'trace-bad' },
    );

    expect(response.artifacts[0]?.type).toBe('TABLE');
    expect(response.artifacts[0]?.chart_spec).toBeNull();
    expect(response.chart).toBeNull();
  });

  it('returns a graceful message (not a 500) when the analytics query fails', async () => {
    const { repository, artifacts } = createFakeRepository();
    const failingRunQuery: RunReadonlyQuery = () =>
      Promise.reject(new Error('relation "ceo_revenue_summary" does not exist'));
    const errorLogs: string[] = [];
    const logger = {
      warn: () => undefined,
      error: (_details: Record<string, unknown>, message: string) => errorLogs.push(message),
    };

    const response = await handleChatMessage(
      { repository, llm: createStubLlmProvider(), runQuery: failingRunQuery, logger },
      {
        userId: 'user-1',
        message: '¿Cómo varió el MRR en los últimos meses?',
        traceId: 'trace-fail',
      },
    );

    expect(response.warnings).toContain('metric_execution_failed');
    expect(response.metadata.answer_source).toBeNull();
    expect(response.artifacts).toEqual([]);
    expect(response.conversation_id).toBe('conversation-1');
    // The real error is logged server-side, and nothing is persisted for the
    // failed turn (no assistant artifact written).
    expect(errorLogs).toContain('analytics.metric_execution_failed');
    expect(artifacts).toHaveLength(0);
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

    const llm = makeLlm({
      planMetricQuery: () => Promise.resolve({ kind: 'clarify', message: specific }),
    });

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

    const llm = makeLlm({
      planMetricQuery: () => Promise.resolve({ kind: 'conversational', message: greeting }),
    });

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
    const llm = makeLlm({
      planMetricQuery: (_prompt, _catalog, _temporal, history) => {
        capturedHistory = history;
        return Promise.resolve({ kind: 'conversational', message: 'De nada.' });
      },
    });

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

  it('produces an ACTION_PLAN artifact in plan mode', async () => {
    const { repository, artifacts } = createFakeRepository();

    const response = await handleChatMessage(
      { repository, llm: createStubLlmProvider(), runQuery: runQueryStub },
      { userId: 'user-1', message: 'plan para el MRR', intentMode: 'plan', traceId: 'trace-plan' },
    );

    expect(response.metadata.metric).toBe('mrr');
    expect(response.artifacts[0]?.type).toBe('ACTION_PLAN');
    expect(artifacts[0]?.artifactType).toBe('ACTION_PLAN');
    const planPayload = artifacts[0]?.payload as { actions?: unknown };
    expect(Array.isArray(planPayload.actions)).toBe(true);
    expect(response.quick_actions).not.toContain('Generar plan de acción');
  });

  it('produces a REPORT artifact with chart_spec in reporte_visual mode', async () => {
    const { repository } = createFakeRepository();

    const response = await handleChatMessage(
      { repository, llm: createStubLlmProvider(), runQuery: runQueryStub },
      {
        userId: 'user-1',
        message: 'reporte del MRR',
        intentMode: 'reporte_visual',
        traceId: 'trace-report',
      },
    );

    expect(response.artifacts[0]?.type).toBe('REPORT');
    expect(response.chart).not.toBeNull();
  });
});

describe('fallback SQL', () => {
  it('answers via governed fallback SQL with a low-confidence alert', async () => {
    const { repository, artifacts } = createFakeRepository();
    const llm = makeLlm({
      planMetricQuery: () => Promise.resolve({ kind: 'clarify', message: 'sin métrica' }),
      generateFallbackSql: () =>
        Promise.resolve({
          sql: 'SELECT period_month, paying_customers FROM ceo_revenue_summary LIMIT 100',
        }),
    });

    const response = await handleChatMessage(
      { repository, llm, runQuery: runQueryStub, fallbackEnabled: true },
      { userId: 'user-1', message: '¿cuántos clientes pagadores por mes?', traceId: 'trace-fb' },
    );

    expect(response.metadata.answer_source).toBe('fallback_sql');
    expect(response.metadata.metric).toBeNull();
    expect(response.warnings.some((w) => w.includes('menos precisa'))).toBe(true);
    expect(response.metadata.validated_sql).toContain('paying_customers');
    expect(artifacts[0]?.payload).toMatchObject({ source: 'fallback_sql' });
  });

  it('falls back to clarification when the LLM has no fallback SQL', async () => {
    const { repository } = createFakeRepository();
    const llm = makeLlm({
      planMetricQuery: () => Promise.resolve({ kind: 'clarify', message: 'precisa' }),
      generateFallbackSql: () => Promise.resolve(null),
    });

    const response = await handleChatMessage(
      { repository, llm, runQuery: runQueryStub, fallbackEnabled: true },
      { userId: 'user-1', message: 'algo raro', traceId: 'trace-fb2' },
    );

    expect(response.metadata.answer_source).toBeNull();
    expect(response.warnings).toContain('metric_not_resolved');
  });

  it('clarifies (never 500) when the fallback SQL is not governable', async () => {
    const { repository } = createFakeRepository();
    const llm = makeLlm({
      planMetricQuery: () => Promise.resolve({ kind: 'clarify', message: 'precisa' }),
      generateFallbackSql: () => Promise.resolve({ sql: 'SELECT email FROM users LIMIT 10' }),
    });

    const response = await handleChatMessage(
      { repository, llm, runQuery: runQueryStub, fallbackEnabled: true },
      { userId: 'user-1', message: 'dame los emails', traceId: 'trace-fb3' },
    );

    expect(response.metadata.answer_source).toBeNull();
    expect(response.warnings).toContain('metric_not_resolved');
  });

  it('does not attempt fallback when disabled', async () => {
    const { repository } = createFakeRepository();
    let fallbackCalls = 0;
    const llm = makeLlm({
      planMetricQuery: () => Promise.resolve({ kind: 'clarify', message: 'precisa' }),
      generateFallbackSql: () => {
        fallbackCalls += 1;
        return Promise.resolve({ sql: 'SELECT period_month FROM ceo_revenue_summary LIMIT 10' });
      },
    });

    const response = await handleChatMessage(
      { repository, llm, runQuery: runQueryStub, fallbackEnabled: false },
      { userId: 'user-1', message: 'algo', traceId: 'trace-fb4' },
    );

    expect(fallbackCalls).toBe(0);
    expect(response.metadata.answer_source).toBeNull();
  });
});

describe('chart visualization mini-chat', () => {
  function seededRepository() {
    const fake = createFakeRepository();
    fake.artifactStore.set('artifact-1', {
      userId: 'user-1',
      record: {
        id: 'artifact-1',
        artifactType: 'CHART',
        chartSpec: { type: 'line', x: 'period_month', y: 'mrr' },
        payload: { metric: 'mrr', rows: [{ period_month: '2026-05-01', mrr: '62700.00' }] },
        sourceViews: ['ceo_revenue_summary'],
      },
    });
    return fake;
  }

  it('applies a pure visual change to chart_spec', async () => {
    const { repository, artifactStore } = seededRepository();
    const llm = makeLlm({
      editChartSpec: () =>
        Promise.resolve({
          kind: 'visual',
          chartSpec: { type: 'bar', x: 'period_month', y: 'mrr' },
        }),
    });

    const response = await editArtifactVisualization(
      { repository, llm },
      {
        userId: 'user-1',
        artifactId: 'artifact-1',
        edit: { kind: 'message', message: 'ponlo de barras' },
      },
    );

    expect(response.requires_main_chat).toBe(false);
    if (!response.requires_main_chat) {
      expect(response.chart_spec).toMatchObject({ type: 'bar', x: 'period_month', y: 'mrr' });
    }
    expect(artifactStore.get('artifact-1')?.record.chartSpec).toMatchObject({ type: 'bar' });
  });

  it('applies a structured change without calling the LLM', async () => {
    const { repository, artifactStore } = seededRepository();
    const llm = makeLlm({
      editChartSpec: () =>
        Promise.reject(new Error('LLM should not be called for structured edits')),
    });

    const response = await editArtifactVisualization(
      { repository, llm },
      {
        userId: 'user-1',
        artifactId: 'artifact-1',
        edit: { kind: 'structured', chartSpec: { type: 'pie', x: 'period_month', y: 'mrr' } },
      },
    );

    expect(response.requires_main_chat).toBe(false);
    if (!response.requires_main_chat) {
      expect(response.chart_spec).toMatchObject({ type: 'pie', x: 'period_month', y: 'mrr' });
    }
    expect(artifactStore.get('artifact-1')?.record.chartSpec).toMatchObject({ type: 'pie' });
  });

  it('clamps a structured edit to existing columns', async () => {
    const { repository } = seededRepository();
    const llm = makeLlm({});

    const response = await editArtifactVisualization(
      { repository, llm },
      {
        userId: 'user-1',
        artifactId: 'artifact-1',
        // `nonexistent` no es columna del artefacto → cae al eje actual (mrr).
        edit: {
          kind: 'structured',
          chartSpec: { type: 'bar', x: 'period_month', y: 'nonexistent' },
        },
      },
    );

    expect(response.requires_main_chat).toBe(false);
    if (!response.requires_main_chat) {
      expect(response.chart_spec).toMatchObject({ type: 'bar', x: 'period_month', y: 'mrr' });
    }
  });

  it('routes to the main chat when the change needs new data', async () => {
    const { repository } = seededRepository();
    const llm = makeLlm({
      editChartSpec: () =>
        Promise.resolve({ kind: 'route_to_main', reason: 'Eso cambia el periodo.' }),
    });

    const response = await editArtifactVisualization(
      { repository, llm },
      {
        userId: 'user-1',
        artifactId: 'artifact-1',
        edit: { kind: 'message', message: 'mejor el último año' },
      },
    );

    expect(response.requires_main_chat).toBe(true);
    if (response.requires_main_chat) {
      expect(response.reason).toBe('Eso cambia el periodo.');
    }
  });

  it('rejects an artifact that does not belong to the user', async () => {
    const { repository } = seededRepository();
    const llm = makeLlm({});

    await expect(
      editArtifactVisualization(
        { repository, llm },
        {
          userId: 'someone-else',
          artifactId: 'artifact-1',
          edit: { kind: 'message', message: 'ponlo de barras' },
        },
      ),
    ).rejects.toThrow(/not found/iu);
  });
});

describe('conversation detail', () => {
  it('maps stored messages and artifacts into the rehydration view', async () => {
    const { repository, conversationDetails } = createFakeRepository();
    conversationDetails.set('conversation-1', {
      userId: 'user-1',
      detail: {
        id: 'conversation-1',
        title: 'MRR',
        messages: [
          {
            id: 'm1',
            role: 'USER',
            content: '¿Cómo varió el MRR?',
            traceId: 'trace-1',
            artifacts: [],
          },
          {
            id: 'm2',
            role: 'ASSISTANT',
            content: 'El MRR creció.',
            traceId: 'trace-1',
            artifacts: [
              {
                id: 'a1',
                artifactType: 'CHART',
                summary: 'El MRR creció.',
                payload: { metric: 'mrr', rows: [{ period_month: '2026-05', mrr: 1 }] },
                chartSpec: { type: 'line', x: 'period_month', y: 'mrr' },
                warnings: ['La consulta no devolvió filas.'],
              },
            ],
          },
        ],
      },
    });

    const response = await getConversationDetail(
      { repository },
      { userId: 'user-1', conversationId: 'conversation-1' },
    );

    expect(response.conversation_id).toBe('conversation-1');
    expect(response.title).toBe('MRR');
    expect(response.messages).toHaveLength(2);
    expect(response.messages[0]).toMatchObject({
      id: 'm1',
      role: 'user',
      content: '¿Cómo varió el MRR?',
    });

    const assistant = response.messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.warnings).toEqual(['La consulta no devolvió filas.']);
    expect(assistant.artifacts).toHaveLength(1);
    expect(assistant.artifacts[0]).toMatchObject({
      id: 'a1',
      type: 'CHART',
      summary: 'El MRR creció.',
    });
    expect(assistant.artifacts[0].chart_spec).toMatchObject({ type: 'line', x: 'period_month' });
  });

  it('throws 404 when the conversation does not belong to the user', async () => {
    const { repository, conversationDetails } = createFakeRepository();
    conversationDetails.set('conversation-1', {
      userId: 'owner',
      detail: { id: 'conversation-1', title: null, messages: [] },
    });

    await expect(
      getConversationDetail(
        { repository },
        { userId: 'intruder', conversationId: 'conversation-1' },
      ),
    ).rejects.toThrow(/not found/iu);
  });
});

describe('rename conversation', () => {
  it("renames a user's own conversation", async () => {
    const { repository, conversationDetails } = createFakeRepository();
    conversationDetails.set('conversation-1', {
      userId: 'user-1',
      detail: { id: 'conversation-1', title: null, messages: [] },
    });

    const result = await renameConversation(
      { repository },
      { userId: 'user-1', conversationId: 'conversation-1', title: 'Ingresos Q1' },
    );

    expect(result).toEqual({ id: 'conversation-1', title: 'Ingresos Q1' });
    expect(conversationDetails.get('conversation-1')?.detail.title).toBe('Ingresos Q1');
  });

  it('throws 404 when renaming a conversation the user does not own', async () => {
    const { repository, conversationDetails } = createFakeRepository();
    conversationDetails.set('conversation-1', {
      userId: 'owner',
      detail: { id: 'conversation-1', title: null, messages: [] },
    });

    await expect(
      renameConversation(
        { repository },
        { userId: 'intruder', conversationId: 'conversation-1', title: 'Hack' },
      ),
    ).rejects.toThrow(/not found/iu);
  });
});

describe('audit logging', () => {
  it('writes one semantic audit row for a metric answer', async () => {
    const { repository } = createFakeRepository();
    const { audit, rows } = createFakeAudit();

    await handleChatMessage(
      { repository, llm: createStubLlmProvider(), runQuery: runQueryStub, audit },
      { userId: 'user-1', message: '¿Cómo varió el MRR?', traceId: 'trace-audit-1' },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      answerSource: 'semantic',
      metric: 'mrr',
      validationStatus: 'VALID',
      clientType: 'WEB',
      traceId: 'trace-audit-1',
    });
    expect(rows[0]?.validatedSql).toContain('FROM ceo_revenue_summary');
    expect(rows[0]?.validatedSqlHash).not.toBeNull();
  });

  it('writes a NOT_APPLICABLE audit row for a clarification', async () => {
    const { repository } = createFakeRepository();
    const { audit, rows } = createFakeAudit();
    const llm = makeLlm({
      planMetricQuery: () => Promise.resolve({ kind: 'clarify', message: 'precisa la métrica' }),
    });

    await handleChatMessage(
      { repository, llm, runQuery: runQueryStub, audit, fallbackEnabled: false },
      { userId: 'user-1', message: 'algo ambiguo', traceId: 'trace-audit-2' },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      answerSource: null,
      validationStatus: 'NOT_APPLICABLE',
      missingMetricOrDimension: 'precisa la métrica',
    });
  });

  it('writes a fallback_sql audit row when the fallback answers', async () => {
    const { repository } = createFakeRepository();
    const { audit, rows } = createFakeAudit();
    const llm = makeLlm({
      planMetricQuery: () => Promise.resolve({ kind: 'clarify', message: 'sin métrica' }),
      generateFallbackSql: () =>
        Promise.resolve({
          sql: 'SELECT period_month, paying_customers FROM ceo_revenue_summary LIMIT 100',
        }),
    });

    await handleChatMessage(
      { repository, llm, runQuery: runQueryStub, audit, fallbackEnabled: true },
      { userId: 'user-1', message: '¿clientes pagadores por mes?', traceId: 'trace-audit-3' },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ answerSource: 'fallback_sql', validationStatus: 'VALID' });
    expect(rows[0]?.generatedSql).toContain('paying_customers');
  });

  it('does not fail the response when the audit write throws', async () => {
    const { repository } = createFakeRepository();
    const audit: AuditRepository = {
      insertAuditLog: () => Promise.reject(new Error('audit db down')),
    };

    const response = await handleChatMessage(
      { repository, llm: createStubLlmProvider(), runQuery: runQueryStub, audit },
      { userId: 'user-1', message: '¿Cómo varió el MRR?', traceId: 'trace-audit-4' },
    );

    expect(response.metadata.metric).toBe('mrr');
    expect(response.metadata.answer_source).toBe('semantic');
  });
});
