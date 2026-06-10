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
import type { LlmProvider, TemporalContext } from './llm/llm-provider.js';

export type RunReadonlyQuery = (sql: string) => Promise<ReadonlyQueryResult>;

// La cobertura temporal de los datos es estatica en el MVP; se cachea por proceso.
let cachedPeriodCoverage:
  | { earliestPeriod: string | null; latestPeriod: string | null }
  | undefined;

async function getTemporalContext(runQuery: RunReadonlyQuery): Promise<TemporalContext> {
  cachedPeriodCoverage ??= await loadPeriodCoverage(runQuery);

  return {
    today: new Date().toISOString().slice(0, 10),
    earliestPeriod: cachedPeriodCoverage.earliestPeriod,
    latestPeriod: cachedPeriodCoverage.latestPeriod,
  };
}

async function loadPeriodCoverage(runQuery: RunReadonlyQuery) {
  try {
    const result = await runQuery(
      'SELECT min(period_month) AS earliest, max(period_month) AS latest FROM ceo_revenue_summary',
    );
    const row = result.rows[0] as { earliest?: unknown; latest?: unknown } | undefined;

    return {
      earliestPeriod: toIsoDate(row?.earliest),
      latestPeriod: toIsoDate(row?.latest),
    };
  } catch {
    return { earliestPeriod: null, latestPeriod: null };
  }
}

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'string' && value !== '') {
    return value.slice(0, 10);
  }

  return null;
}

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
  const temporalContext = await getTemporalContext(deps.runQuery);
  const recentMessages = await deps.repository.listRecentMessages(conversationId);

  let plan: { query: ReturnType<typeof validateMetricQuery>['query']; metric: MetricDefinition };

  try {
    const metricPlan = await deps.llm.planMetricQuery(
      input.message,
      catalogContext,
      temporalContext,
      recentMessages,
    );

    if (metricPlan.kind === 'conversational') {
      return await respondConversational(
        deps,
        conversationId,
        input,
        intentMode,
        metricPlan.message,
      );
    }

    if (metricPlan.kind === 'clarify') {
      return await respondClarification(
        deps,
        conversationId,
        input,
        intentMode,
        metricPlan.message,
      );
    }

    plan = validateMetricQuery(metricPlan.query);
  } catch {
    // Errores del proveedor LLM o de validacion: aclaracion, no 500.
    return respondClarification(deps, conversationId, input, intentMode);
  }

  const compiled = compileMetricQuery(plan.query, plan.metric);
  const queryResult = await deps.runQuery(compiled.sql);
  const jsonRows = JSON.parse(JSON.stringify(queryResult.rows)) as Prisma.InputJsonValue;

  const artifactType = pickArtifactType(plan.metric, queryResult.rows);
  const chartSpec = buildChartSpec(plan.metric, artifactType);
  const narrative = await composeNarrativeSafe(deps, input, plan, queryResult.rows);
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
  message?: string,
): Promise<ChatResponse> {
  const text =
    message ??
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

async function respondConversational(
  deps: ChatServiceDeps,
  conversationId: string,
  input: HandleChatInput,
  intentMode: ReturnType<typeof toPrismaIntentMode>,
  message: string,
): Promise<ChatResponse> {
  const assistantMessage = await deps.repository.insertMessage({
    conversationId,
    role: 'ASSISTANT',
    content: message,
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
    summary: message,
    payload: { conversational: true },
    chartSpec: null,
    freshness: null,
    warnings: [],
    traceId: input.traceId,
  });

  return {
    trace_id: input.traceId,
    conversation_id: conversationId,
    message,
    data: [],
    artifacts: [
      { type: 'TEXT', summary: message, payload: { conversational: true }, chart_spec: null },
    ],
    chart: null,
    warnings: [],
    suggested_questions: [...SUGGESTED_QUESTIONS],
    metadata: {
      metric: null,
      source_views: [],
      validated_sql: null,
      intent_mode: input.intentMode ?? null,
    },
  };
}

async function composeNarrativeSafe(
  deps: ChatServiceDeps,
  input: HandleChatInput,
  plan: { query: ReturnType<typeof validateMetricQuery>['query']; metric: MetricDefinition },
  rows: unknown[],
): Promise<string> {
  try {
    return await deps.llm.composeNarrative({
      question: input.message,
      metricLabel: plan.metric.label,
      format: plan.metric.format,
      rows,
      context: describeQueryContext(plan.query),
    });
  } catch {
    // Si la narrativa LLM falla, no perdemos los datos ya calculados.
    return `${plan.metric.label}: ${String(rows.length)} registro(s) recuperados.`;
  }
}

// Resume filtros y periodo aplicados para que la narrativa conozca el sujeto
// (p.ej. un cliente filtrado) aunque no este en las columnas proyectadas.
function describeQueryContext(query: ReturnType<typeof validateMetricQuery>['query']): string {
  const parts: string[] = [];

  for (const filter of query.filters) {
    const value = Array.isArray(filter.value) ? filter.value.join(', ') : String(filter.value);
    parts.push(`${filter.field} ${filter.operator} ${value}`);
  }

  if (query.time_range !== undefined) {
    parts.push(`periodo ${query.time_range.from}..${query.time_range.to}`);
  }

  return parts.join('; ');
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
