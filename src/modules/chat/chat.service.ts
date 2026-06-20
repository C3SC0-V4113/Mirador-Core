import { type ArtifactType, Prisma } from '@prisma/client';

import { AppError } from '../../shared/errors/app-error.js';
import type { MetricDefinition } from '../schema-catalog/metric-catalog.js';
import {
  buildMetricCatalogContext,
  validateMetricQuery,
} from '../schema-catalog/metric-catalog.js';
import { compileMetricQuery } from '../sql-safety/metric-query-compiler.js';
import type { ReadonlyQueryResult } from '../sql-safety/readonly-query.service.js';
import type { ArtifactRecord, ChatRepository } from './chat.repositories.js';
import {
  SUGGESTED_QUESTIONS,
  VISUALIZATION_CHART_TYPES,
  type IntentModeInput,
  toPrismaIntentMode,
} from './chat.schemas.js';
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
  id: string;
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
  quick_actions: string[];
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

  const catalogContext = buildMetricCatalogContext();
  const temporalContext = await getTemporalContext(deps.runQuery);
  // Historial = turnos PREVIOS. Se lee antes de insertar el mensaje actual para
  // no duplicarlo (el mensaje actual se anexa una sola vez, ya delimitado).
  const recentMessages = await deps.repository.listRecentMessages(conversationId);

  await deps.repository.insertMessage({
    conversationId,
    role: 'USER',
    content: input.message,
    intentMode,
    traceId: input.traceId,
  });

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

  const artifactType = pickArtifactType(plan.metric, queryResult.rows, input.intentMode);
  const chartSpec = buildChartSpec(plan.metric, artifactType);
  const narrative = await composeNarrativeSafe(deps, input, plan, queryResult.rows);
  const warnings = queryResult.rows.length === 0 ? ['La consulta no devolvió filas.'] : [];
  const period = derivePeriod(plan.query);
  const freshness = new Date().toISOString();

  // El modo solo cambia COMO se presenta la metrica resuelta, no la metrica.
  let payload: Prisma.InputJsonValue = { metric: plan.metric.name, rows: jsonRows };

  if (artifactType === 'ACTION_PLAN') {
    const actions = await composePlanSafe(deps, input, plan, queryResult.rows);
    payload = { metric: plan.metric.name, actions, rows: jsonRows };
  } else if (artifactType === 'REPORT') {
    payload = { metric: plan.metric.name, summary: narrative, rows: jsonRows };
  }

  const assistantMessage = await deps.repository.insertMessage({
    conversationId,
    role: 'ASSISTANT',
    content: narrative,
    intentMode,
    traceId: input.traceId,
  });

  const artifactRow = await deps.repository.insertArtifact({
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
    artifacts: [
      {
        id: artifactRow.id,
        type: artifactType,
        summary: narrative,
        payload,
        chart_spec: chartSpec,
      },
    ],
    chart: chartSpec,
    warnings,
    suggested_questions: [...SUGGESTED_QUESTIONS],
    quick_actions: buildQuickActions(artifactType),
    metadata: {
      metric: plan.metric.name,
      source_views: queryResult.sourceViews,
      validated_sql: queryResult.validatedSql,
      intent_mode: input.intentMode ?? null,
    },
  };
}

const DEFAULT_CLARIFICATION =
  'No pude asociar tu pregunta a una métrica del catálogo. ¿Puedes precisar la métrica o el periodo?';

// Respuesta de solo texto (aclaracion o conversacional): persiste mensaje +
// artefacto TEXT y arma el payload de respuesta. Unifica ambos caminos no-metrica.
async function respondText(
  deps: ChatServiceDeps,
  conversationId: string,
  input: HandleChatInput,
  intentMode: ReturnType<typeof toPrismaIntentMode>,
  options: { message: string; payloadKey: 'clarification' | 'conversational'; warnings: string[] },
): Promise<ChatResponse> {
  const { message, payloadKey, warnings } = options;
  const payload: Prisma.InputJsonValue = { [payloadKey]: true };

  const assistantMessage = await deps.repository.insertMessage({
    conversationId,
    role: 'ASSISTANT',
    content: message,
    intentMode,
    traceId: input.traceId,
  });

  const artifactRow = await deps.repository.insertArtifact({
    conversationId,
    messageId: assistantMessage.id,
    artifactType: 'TEXT',
    question: input.message,
    period: null,
    sourceViews: [],
    validatedSql: null,
    summary: message,
    payload,
    chartSpec: null,
    freshness: null,
    warnings,
    traceId: input.traceId,
  });

  return {
    trace_id: input.traceId,
    conversation_id: conversationId,
    message,
    data: [],
    artifacts: [{ id: artifactRow.id, type: 'TEXT', summary: message, payload, chart_spec: null }],
    chart: null,
    warnings,
    suggested_questions: [...SUGGESTED_QUESTIONS],
    quick_actions: [],
    metadata: {
      metric: null,
      source_views: [],
      validated_sql: null,
      intent_mode: input.intentMode ?? null,
    },
  };
}

function respondClarification(
  deps: ChatServiceDeps,
  conversationId: string,
  input: HandleChatInput,
  intentMode: ReturnType<typeof toPrismaIntentMode>,
  message?: string,
): Promise<ChatResponse> {
  return respondText(deps, conversationId, input, intentMode, {
    message: message ?? DEFAULT_CLARIFICATION,
    payloadKey: 'clarification',
    warnings: ['metric_not_resolved'],
  });
}

function respondConversational(
  deps: ChatServiceDeps,
  conversationId: string,
  input: HandleChatInput,
  intentMode: ReturnType<typeof toPrismaIntentMode>,
  message: string,
): Promise<ChatResponse> {
  return respondText(deps, conversationId, input, intentMode, {
    message,
    payloadKey: 'conversational',
    warnings: [],
  });
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
      intentMode: input.intentMode,
    });
  } catch {
    // Si la narrativa LLM falla, no perdemos los datos ya calculados.
    return `${plan.metric.label}: ${String(rows.length)} registro(s) recuperados.`;
  }
}

async function composePlanSafe(
  deps: ChatServiceDeps,
  input: HandleChatInput,
  plan: { query: ReturnType<typeof validateMetricQuery>['query']; metric: MetricDefinition },
  rows: unknown[],
): Promise<{ title: string; detail: string }[]> {
  try {
    return await deps.llm.composePlan({
      question: input.message,
      metricLabel: plan.metric.label,
      rows,
      context: describeQueryContext(plan.query),
    });
  } catch {
    return [];
  }
}

function buildQuickActions(artifactType: ArtifactType): string[] {
  const actions: string[] = [];

  if (artifactType === 'CHART' || artifactType === 'REPORT') {
    actions.push('Ver como tabla', 'Cambiar a barras');
  }

  if (artifactType !== 'ACTION_PLAN') {
    actions.push('Generar plan de acción');
  }

  actions.push('Comparar con el periodo anterior');

  return actions;
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

function pickArtifactType(
  metric: MetricDefinition,
  rows: unknown[],
  intentMode: IntentModeInput | undefined,
): ArtifactType {
  // El modo prioriza el tipo de artefacto sobre la metrica ya resuelta.
  if (intentMode === 'plan') {
    return 'ACTION_PLAN';
  }

  if (intentMode === 'reporte_visual') {
    return 'REPORT';
  }

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
  // CHART y REPORT llevan visualizacion; el resto no.
  if (artifactType !== 'CHART' && artifactType !== 'REPORT') {
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

export type EditVisualizationDeps = {
  repository: ChatRepository;
  llm: LlmProvider;
};

export type EditVisualizationInput = {
  userId: string;
  artifactId: string;
  message: string;
};

export type VisualizationResponse =
  | { requires_main_chat: true; reason: string; artifact_id: string }
  | { requires_main_chat: false; artifact_id: string; chart_spec: Prisma.InputJsonValue };

// Mini-chat de gráficas: edita SOLO la visualización (chart_spec) de un artefacto
// ya generado, sin re-consultar. Si el pedido cambia datos, deriva al chat principal.
export async function editArtifactVisualization(
  deps: EditVisualizationDeps,
  input: EditVisualizationInput,
): Promise<VisualizationResponse> {
  const artifact = await deps.repository.getArtifactForUser(input.artifactId, input.userId);

  if (artifact === null) {
    throw new AppError('Artifact not found.', 404, 'CHART_ARTIFACT_NOT_FOUND');
  }

  const availableColumns = extractArtifactColumns(artifact);
  const edit = await deps.llm.editChartSpec({
    message: input.message,
    currentChartSpec: artifact.chartSpec,
    availableColumns,
  });

  if (edit.kind === 'route_to_main') {
    return { requires_main_chat: true, reason: edit.reason, artifact_id: artifact.id };
  }

  const allowedTypes = new Set<string>(VISUALIZATION_CHART_TYPES);

  if (!allowedTypes.has(edit.chartSpec.type)) {
    throw new AppError(
      `Chart type "${edit.chartSpec.type}" is not allowed.`,
      422,
      'CHART_TYPE_NOT_ALLOWED',
    );
  }

  // Clamp de ejes a columnas reales del artefacto; si el modelo desvaria, caemos
  // al chart_spec actual en vez de persistir ejes inexistentes.
  const columns = new Set(availableColumns);
  const current =
    typeof artifact.chartSpec === 'object' && artifact.chartSpec !== null
      ? (artifact.chartSpec as { x?: unknown; y?: unknown })
      : {};
  const currentX = typeof current.x === 'string' ? current.x : null;
  const currentY = typeof current.y === 'string' ? current.y : (availableColumns[0] ?? '');

  const chartSpec: Prisma.InputJsonValue = {
    type: edit.chartSpec.type,
    x: edit.chartSpec.x !== null && columns.has(edit.chartSpec.x) ? edit.chartSpec.x : currentX,
    y: columns.has(edit.chartSpec.y) ? edit.chartSpec.y : currentY,
  };

  await deps.repository.updateArtifactChartSpec(artifact.id, chartSpec);

  return { requires_main_chat: false, artifact_id: artifact.id, chart_spec: chartSpec };
}

function extractArtifactColumns(artifact: ArtifactRecord): string[] {
  const payload = artifact.payload;

  if (typeof payload !== 'object' || payload === null || !('rows' in payload)) {
    return [];
  }

  const rows = (payload as { rows?: unknown }).rows;

  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const firstRow: unknown = rows[0];

  if (typeof firstRow !== 'object' || firstRow === null) {
    return [];
  }

  return Object.keys(firstRow);
}
