import { type ArtifactType, Prisma } from '@prisma/client';

import type { MetricDefinition } from '../schema-catalog/metric-catalog.js';
import {
  buildMetricCatalogContext,
  validateMetricQuery,
} from '../schema-catalog/metric-catalog.js';
import { compileMetricQuery } from '../sql-safety/metric-query-compiler.js';
import type { ReadonlyQueryResult } from '../sql-safety/readonly-query.service.js';
import type { ChatRepository } from './chat.repositories.js';
import { SUGGESTED_QUESTIONS, type IntentModeInput, toPrismaIntentMode } from './chat.schemas.js';
import type { LlmProvider } from './llm/llm-provider.js';

export type RunReadonlyQuery = (sql: string) => Promise<ReadonlyQueryResult>;

export type ChatServiceDeps = {
  repository: ChatRepository;
  llm: LlmProvider;
  runQuery: RunReadonlyQuery;
};

export type HandleChatInput = {
  userId: string;
  message: string;
  conversationId?: string;
  intentMode?: IntentModeInput;
  traceId: string;
};

export type ChatArtifactView = {
  type: ArtifactType;
  summary: string;
  payload: unknown;
  chart_spec: unknown;
};

export type ChatResponse = {
  trace_id: string;
  conversation_id: string;
  message: string;
  data: unknown[];
  artifacts: ChatArtifactView[];
  chart: unknown;
  warnings: string[];
  suggested_questions: string[];
  metadata: {
    metric: string | null;
    source_views: string[];
    validated_sql: string | null;
    intent_mode: IntentModeInput | null;
  };
};

export async function handleChatMessage(
  deps: ChatServiceDeps,
  input: HandleChatInput,
): Promise<ChatResponse> {
  const intentMode = toPrismaIntentMode(input.intentMode);
  const conversationId = await deps.repository.ensureConversation(
    input.userId,
    input.conversationId,
  );

  await deps.repository.insertMessage({
    conversationId,
    role: 'USER',
    content: input.message,
    intentMode,
    traceId: input.traceId,
  });

  const catalogContext = buildMetricCatalogContext();
  const candidate = await deps.llm.planMetricQuery(input.message, catalogContext);

  let plan: { query: ReturnType<typeof validateMetricQuery>['query']; metric: MetricDefinition };

  try {
    if (candidate === null) {
      throw new Error('No metric resolved.');
    }

    plan = validateMetricQuery(candidate);
  } catch {
    return respondClarification(deps, conversationId, input, intentMode);
  }

  const compiled = compileMetricQuery(plan.query, plan.metric);
  const queryResult = await deps.runQuery(compiled.sql);
  const jsonRows = JSON.parse(JSON.stringify(queryResult.rows)) as Prisma.InputJsonValue;

  const artifactType = pickArtifactType(plan.metric, queryResult.rows);
  const chartSpec = buildChartSpec(plan.metric, artifactType);
  const narrative = await deps.llm.composeNarrative({
    question: input.message,
    metricLabel: plan.metric.label,
    format: plan.metric.format,
    rows: queryResult.rows,
  });
  const warnings = queryResult.rows.length === 0 ? ['La consulta no devolvió filas.'] : [];
  const period = derivePeriod(plan.query);
  const freshness = new Date().toISOString();

  const assistantMessage = await deps.repository.insertMessage({
    conversationId,
    role: 'ASSISTANT',
    content: narrative,
    intentMode,
    traceId: input.traceId,
  });

  const payload: Prisma.InputJsonValue = { metric: plan.metric.name, rows: jsonRows };

  await deps.repository.insertArtifact({
    conversationId,
    messageId: assistantMessage.id,
    artifactType,
    question: input.message,
    period,
    sourceViews: queryResult.sourceViews,
    validatedSql: queryResult.validatedSql,
    summary: narrative,
    payload,
    chartSpec,
    freshness,
    warnings,
    traceId: input.traceId,
  });

  return {
    trace_id: input.traceId,
    conversation_id: conversationId,
    message: narrative,
    data: queryResult.rows,
    artifacts: [{ type: artifactType, summary: narrative, payload, chart_spec: chartSpec }],
    chart: chartSpec,
    warnings,
    suggested_questions: [...SUGGESTED_QUESTIONS],
    metadata: {
      metric: plan.metric.name,
      source_views: queryResult.sourceViews,
      validated_sql: queryResult.validatedSql,
      intent_mode: input.intentMode ?? null,
    },
  };
}

async function respondClarification(
  deps: ChatServiceDeps,
  conversationId: string,
  input: HandleChatInput,
  intentMode: ReturnType<typeof toPrismaIntentMode>,
): Promise<ChatResponse> {
  const text =
    'No pude asociar tu pregunta a una métrica del catálogo. ¿Puedes precisar la métrica o el periodo?';

  const assistantMessage = await deps.repository.insertMessage({
    conversationId,
    role: 'ASSISTANT',
    content: text,
    intentMode,
    traceId: input.traceId,
  });

  await deps.repository.insertArtifact({
    conversationId,
    messageId: assistantMessage.id,
    artifactType: 'TEXT',
    question: input.message,
    period: null,
    sourceViews: [],
    validatedSql: null,
    summary: text,
    payload: { clarification: true },
    chartSpec: null,
    freshness: null,
    warnings: ['metric_not_resolved'],
    traceId: input.traceId,
  });

  return {
    trace_id: input.traceId,
    conversation_id: conversationId,
    message: text,
    data: [],
    artifacts: [
      { type: 'TEXT', summary: text, payload: { clarification: true }, chart_spec: null },
    ],
    chart: null,
    warnings: ['metric_not_resolved'],
    suggested_questions: [...SUGGESTED_QUESTIONS],
    metadata: {
      metric: null,
      source_views: [],
      validated_sql: null,
      intent_mode: input.intentMode ?? null,
    },
  };
}

function pickArtifactType(metric: MetricDefinition, rows: unknown[]): ArtifactType {
  if (metric.default_chart === 'table') {
    return 'TABLE';
  }

  if (rows.length <= 1) {
    return 'KPI';
  }

  return 'CHART';
}

function buildChartSpec(
  metric: MetricDefinition,
  artifactType: ArtifactType,
): Prisma.InputJsonValue | null {
  if (artifactType !== 'CHART') {
    return null;
  }

  const firstDimension = metric.dimensions.length > 0 ? metric.dimensions[0] : null;

  return {
    type: metric.default_chart,
    x: metric.time_column ?? firstDimension,
    y: metric.measure,
  };
}

function derivePeriod(query: ReturnType<typeof validateMetricQuery>['query']): string | null {
  if (query.time_range === undefined) {
    return null;
  }

  return `${query.time_range.from}..${query.time_range.to}`;
}
