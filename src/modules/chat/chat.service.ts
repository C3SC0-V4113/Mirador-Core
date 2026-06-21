import { type ArtifactType, Prisma } from '@prisma/client';

import { AppError } from '../../shared/errors/app-error.js';
import type { MetricDefinition } from '../schema-catalog/metric-catalog.js';
import {
  buildBusinessSchemaContext,
  buildMetricCatalogContext,
  validateMetricQuery,
} from '../schema-catalog/metric-catalog.js';
import { compileMetricQuery } from '../sql-safety/metric-query-compiler.js';
import type { ReadonlyQueryResult } from '../sql-safety/readonly-query.service.js';
import { validateReadonlySql } from '../sql-safety/sql-safety.js';
import type { ArtifactRecord, ChatRepository } from './chat.repositories.js';
import {
  SUGGESTED_QUESTIONS,
  VISUALIZATION_CHART_TYPES,
  type IntentModeInput,
  toPrismaIntentMode,
} from './chat.schemas.js';
import type {
  ChartSpec,
  FollowUpInput,
  LlmProvider,
  MetricCatalogContext,
  TemporalContext,
} from './llm/llm-provider.js';

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

export type ChatLogger = {
  warn: (details: Record<string, unknown>, message: string) => void;
  error?: (details: Record<string, unknown>, message: string) => void;
};

export type ChatServiceDeps = {
  repository: ChatRepository;
  llm: LlmProvider;
  runQuery: RunReadonlyQuery;
  fallbackEnabled?: boolean;
  logger?: ChatLogger;
};

export type AnswerSource = 'semantic' | 'fallback_sql' | null;

const FALLBACK_WARNING =
  'Respuesta generada con SQL exploratorio fuera del catálogo de métricas; puede ser menos precisa. Verifica antes de tomar decisiones.';

// Mensaje al CEO cuando la ejecucion de la consulta o la persistencia falla. El
// error real se loguea server-side; al usuario no le exponemos detalles internos.
const EXECUTION_ERROR_MESSAGE =
  'No pude completar la consulta sobre los datos en este momento. Por favor, inténtalo de nuevo en unos minutos.';

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
    answer_source: AnswerSource;
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
      // El catalogo no cubre la pregunta: intentar fallback SQL gobernado antes
      // de aclarar. Si no produce datos, cae a la aclaracion del planner.
      if (deps.fallbackEnabled === true) {
        const fallback = await tryFallbackSql(
          deps,
          conversationId,
          input,
          intentMode,
          temporalContext,
          catalogContext,
        );

        if (fallback !== null) {
          return fallback;
        }
      }

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

  // Ejecucion + persistencia: si la DB de analitica falla o no esta disponible,
  // o la persistencia falla, NO devolvemos 500. Logueamos el error real y
  // respondemos con un mensaje claro al CEO.
  try {
    const compiled = compileMetricQuery(plan.query, plan.metric);
    const queryResult = await deps.runQuery(compiled.sql);
    const jsonRows = JSON.parse(JSON.stringify(queryResult.rows)) as Prisma.InputJsonValue;

    let artifactType = pickArtifactType(plan.metric, queryResult.rows, input.intentMode);
    let chartSpec = buildChartSpec(plan.metric, artifactType, plan.query);

    // Si el grafico no es renderizable (sus columnas no estan en los datos), no
    // emitimos un grafico vacio: degradamos un CHART a TABLA (el CEO ve los datos)
    // y, en REPORT, lo dejamos sin grafico (conserva resumen + tabla).
    if (chartSpec !== null && !chartColumnsRenderable(chartSpec, queryResult.rows)) {
      chartSpec = null;
      if (artifactType === 'CHART') {
        artifactType = 'TABLE';
      }
    }
    // Narrativa y sugerencias en paralelo: ambas usan el modelo liviano, así no
    // sumamos latencia perceptible. Las sugerencias son contextuales a la métrica.
    const [narrative, suggestedQuestions] = await Promise.all([
      composeNarrativeSafe(deps, input, plan, queryResult.rows),
      suggestFollowUpsSafe(deps, {
        question: input.message,
        metricLabel: plan.metric.label,
        rows: queryResult.rows,
        context: describeQueryContext(plan.query),
        catalogContext,
      }),
    ]);
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
      suggested_questions: suggestedQuestions,
      quick_actions: buildQuickActions(artifactType),
      metadata: {
        metric: plan.metric.name,
        source_views: queryResult.sourceViews,
        validated_sql: queryResult.validatedSql,
        intent_mode: input.intentMode ?? null,
        answer_source: 'semantic',
      },
    };
  } catch (error) {
    deps.logger?.error?.(
      {
        trace_id: input.traceId,
        metric: plan.metric.name,
        err: error instanceof Error ? error.message : String(error),
      },
      'analytics.metric_execution_failed',
    );

    return buildExecutionErrorResponse(conversationId, input);
  }
}

// Respuesta graceful (sin escribir en la DB) cuando la ejecucion de la metrica
// falla: evita el 500 y no depende de que la persistencia funcione.
function buildExecutionErrorResponse(conversationId: string, input: HandleChatInput): ChatResponse {
  return {
    trace_id: input.traceId,
    conversation_id: conversationId,
    message: EXECUTION_ERROR_MESSAGE,
    data: [],
    artifacts: [],
    chart: null,
    warnings: ['metric_execution_failed'],
    suggested_questions: [...SUGGESTED_QUESTIONS],
    quick_actions: [],
    metadata: {
      metric: null,
      source_views: [],
      validated_sql: null,
      intent_mode: input.intentMode ?? null,
      answer_source: null,
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
      answer_source: null,
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

// Sugerencias de seguimiento contextuales; cae al set estatico si el LLM falla o
// no devuelve nada, para no dejar la respuesta sin preguntas sugeridas.
async function suggestFollowUpsSafe(
  deps: ChatServiceDeps,
  input: FollowUpInput,
): Promise<string[]> {
  try {
    const result = await deps.llm.suggestFollowUps(input);
    return result.length > 0 ? result : [...SUGGESTED_QUESTIONS];
  } catch {
    return [...SUGGESTED_QUESTIONS];
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

// Fallback SQL gobernado: cuando el catalogo no cubre la pregunta, el LLM propone
// un SELECT sobre las views ceo_*, que pasa por el SQL Safety Layer y se ejecuta
// read-only. Devuelve null (cae a aclaracion) si no hay candidato o no es seguro.
// Toda respuesta por esta via lleva una alerta de baja confianza.
async function tryFallbackSql(
  deps: ChatServiceDeps,
  conversationId: string,
  input: HandleChatInput,
  intentMode: ReturnType<typeof toPrismaIntentMode>,
  temporalContext: TemporalContext,
  catalogContext: MetricCatalogContext,
): Promise<ChatResponse | null> {
  const candidate = await deps.llm.generateFallbackSql({
    question: input.message,
    schemaContext: buildBusinessSchemaContext(),
    temporalContext,
  });

  if (candidate === null) {
    return null;
  }

  let result: ReadonlyQueryResult;

  try {
    const validated = validateReadonlySql(candidate.sql);
    result = await deps.runQuery(validated.sql);
  } catch {
    // SQL no gobernable o fallo de ejecucion: no exponemos el error, caemos a aclaracion.
    return null;
  }

  deps.logger?.warn(
    {
      trace_id: input.traceId,
      validated_sql: result.validatedSql,
      source_views: result.sourceViews,
    },
    'analytics.fallback_sql_triggered',
  );

  const jsonRows = JSON.parse(JSON.stringify(result.rows)) as Prisma.InputJsonValue;
  const artifactType: ArtifactType = result.rows.length <= 1 ? 'KPI' : 'TABLE';
  const [narrative, suggestedQuestions] = await Promise.all([
    composeFallbackNarrative(deps, input, result.rows),
    suggestFollowUpsSafe(deps, {
      question: input.message,
      metricLabel: 'Consulta exploratoria',
      rows: result.rows,
      context: '',
      catalogContext,
    }),
  ]);
  const warnings = [FALLBACK_WARNING];
  const payload: Prisma.InputJsonValue = { source: 'fallback_sql', rows: jsonRows };

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
    period: null,
    sourceViews: result.sourceViews,
    validatedSql: result.validatedSql,
    summary: narrative,
    payload,
    chartSpec: null,
    freshness: new Date().toISOString(),
    warnings,
    traceId: input.traceId,
  });

  return {
    trace_id: input.traceId,
    conversation_id: conversationId,
    message: narrative,
    data: result.rows,
    artifacts: [
      { id: artifactRow.id, type: artifactType, summary: narrative, payload, chart_spec: null },
    ],
    chart: null,
    warnings,
    suggested_questions: suggestedQuestions,
    quick_actions: buildQuickActions(artifactType),
    metadata: {
      metric: null,
      source_views: result.sourceViews,
      validated_sql: result.validatedSql,
      intent_mode: input.intentMode ?? null,
      answer_source: 'fallback_sql',
    },
  };
}

async function composeFallbackNarrative(
  deps: ChatServiceDeps,
  input: HandleChatInput,
  rows: unknown[],
): Promise<string> {
  try {
    return await deps.llm.composeNarrative({
      question: input.message,
      metricLabel: 'Consulta exploratoria',
      format: 'decimal',
      rows,
      context: '',
      intentMode: input.intentMode,
    });
  } catch {
    return `Consulta exploratoria: ${String(rows.length)} registro(s) recuperados.`;
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
  query: ReturnType<typeof validateMetricQuery>['query'],
): Prisma.InputJsonValue | null {
  // CHART y REPORT llevan visualizacion; el resto no.
  if (artifactType !== 'CHART' && artifactType !== 'REPORT') {
    return null;
  }

  // El eje X debe ser una columna REALMENTE proyectada. El compilador proyecta las
  // dimensiones cuando hay; si no, la time_column. Espejamos esa logica para que el
  // eje exista en las filas (evita graficos vacios al consultar por dimension).
  const firstDimension = metric.dimensions.length > 0 ? metric.dimensions[0] : null;
  const x =
    query.dimensions.length > 0 ? query.dimensions[0] : (metric.time_column ?? firstDimension);

  return {
    type: metric.default_chart,
    x,
    y: metric.measure,
  };
}

// Verifica que el eje X y la medida del chart_spec existan como columnas en las
// filas. Si no, el grafico no es renderizable y conviene degradar a tabla.
function chartColumnsRenderable(chartSpec: Prisma.InputJsonValue | null, rows: unknown[]): boolean {
  if (chartSpec === null || typeof chartSpec !== 'object') {
    return false;
  }

  const firstRow = rows[0];

  if (typeof firstRow !== 'object' || firstRow === null) {
    return false;
  }

  const columns = new Set(Object.keys(firstRow));
  const spec = chartSpec as { x?: unknown; y?: unknown };

  return (
    typeof spec.x === 'string' &&
    columns.has(spec.x) &&
    typeof spec.y === 'string' &&
    columns.has(spec.y)
  );
}

function derivePeriod(query: ReturnType<typeof validateMetricQuery>['query']): string | null {
  if (query.time_range === undefined) {
    return null;
  }

  return `${query.time_range.from}..${query.time_range.to}`;
}

export type ConversationDetailMessageView = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  trace_id: string;
  warnings: string[];
  artifacts: ChatArtifactView[];
};

export type ConversationDetailResponse = {
  conversation_id: string;
  title: string | null;
  messages: ConversationDetailMessageView[];
};

export type GetConversationDetailDeps = { repository: ChatRepository };

export type GetConversationDetailInput = { userId: string; conversationId: string };

// Rehidrata una conversacion previa: mensajes en orden con sus artefactos en el
// mismo shape (ChatArtifactView) que emite handleChatMessage, para que el
// frontend reuse exactamente el mismo mapeo de artefactos al reabrir el hilo.
export async function getConversationDetail(
  deps: GetConversationDetailDeps,
  input: GetConversationDetailInput,
): Promise<ConversationDetailResponse> {
  const detail = await deps.repository.getConversationDetail(input.conversationId, input.userId);

  if (detail === null) {
    throw new AppError('Conversation not found.', 404, 'CONVERSATION_NOT_FOUND');
  }

  return {
    conversation_id: detail.id,
    title: detail.title,
    messages: detail.messages.map((message) => ({
      id: message.id,
      role: message.role === 'ASSISTANT' ? 'assistant' : 'user',
      content: message.content,
      trace_id: message.traceId,
      // Las advertencias se persisten por artefacto; se agregan a nivel mensaje
      // (deduplicadas) para reconstruir el bloque de advertencias del asistente.
      warnings: [...new Set(message.artifacts.flatMap((artifact) => artifact.warnings))],
      artifacts: message.artifacts.map((artifact) => ({
        id: artifact.id,
        type: artifact.artifactType,
        summary: artifact.summary ?? '',
        payload: artifact.payload,
        chart_spec: artifact.chartSpec,
      })),
    })),
  };
}

export type RenameConversationDeps = { repository: ChatRepository };

export type RenameConversationInput = { userId: string; conversationId: string; title: string };

// Renombra una conversacion del usuario. Lanza 404 si no existe o no le pertenece.
export async function renameConversation(
  deps: RenameConversationDeps,
  input: RenameConversationInput,
): Promise<{ id: string; title: string }> {
  const renamed = await deps.repository.renameConversation(
    input.conversationId,
    input.userId,
    input.title,
  );

  if (!renamed) {
    throw new AppError('Conversation not found.', 404, 'CONVERSATION_NOT_FOUND');
  }

  return { id: input.conversationId, title: input.title };
}

export type EditVisualizationDeps = {
  repository: ChatRepository;
  llm: LlmProvider;
};

export type EditVisualizationInput = {
  userId: string;
  artifactId: string;
  // Lenguaje natural (interpretado por el LLM) o cambio estructurado directo.
  edit: { kind: 'message'; message: string } | { kind: 'structured'; chartSpec: ChartSpec };
};

export type VisualizationResponse =
  | { requires_main_chat: true; reason: string; artifact_id: string }
  | { requires_main_chat: false; artifact_id: string; chart_spec: Prisma.InputJsonValue };

// Mini-chat de gráficas: edita SOLO la visualización (chart_spec) de un artefacto
// ya generado, sin re-consultar. El modo estructurado (botones) aplica el cambio
// directo; el modo lenguaje natural lo interpreta el LLM y puede derivar al chat
// principal si el pedido cambia datos. Ambos pasan por la misma validación/clamp.
export async function editArtifactVisualization(
  deps: EditVisualizationDeps,
  input: EditVisualizationInput,
): Promise<VisualizationResponse> {
  const artifact = await deps.repository.getArtifactForUser(input.artifactId, input.userId);

  if (artifact === null) {
    throw new AppError('Artifact not found.', 404, 'CHART_ARTIFACT_NOT_FOUND');
  }

  const availableColumns = extractArtifactColumns(artifact);

  let desiredSpec: ChartSpec;

  if (input.edit.kind === 'structured') {
    desiredSpec = input.edit.chartSpec;
  } else {
    const edit = await deps.llm.editChartSpec({
      message: input.edit.message,
      currentChartSpec: artifact.chartSpec,
      availableColumns,
    });

    if (edit.kind === 'route_to_main') {
      return { requires_main_chat: true, reason: edit.reason, artifact_id: artifact.id };
    }

    desiredSpec = edit.chartSpec;
  }

  const allowedTypes = new Set<string>(VISUALIZATION_CHART_TYPES);

  if (!allowedTypes.has(desiredSpec.type)) {
    throw new AppError(
      `Chart type "${desiredSpec.type}" is not allowed.`,
      422,
      'CHART_TYPE_NOT_ALLOWED',
    );
  }

  // Clamp de ejes a columnas reales del artefacto; si el eje pedido no existe,
  // caemos al chart_spec actual en vez de persistir ejes inexistentes.
  const columns = new Set(availableColumns);
  const current =
    typeof artifact.chartSpec === 'object' && artifact.chartSpec !== null
      ? (artifact.chartSpec as { x?: unknown; y?: unknown })
      : {};
  const currentX = typeof current.x === 'string' ? current.x : null;
  const currentY = typeof current.y === 'string' ? current.y : (availableColumns[0] ?? '');
  const desiredX = desiredSpec.x ?? null;

  const chartSpec: Prisma.InputJsonValue = {
    type: desiredSpec.type,
    x: desiredX !== null && columns.has(desiredX) ? desiredX : currentX,
    y: columns.has(desiredSpec.y) ? desiredSpec.y : currentY,
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
