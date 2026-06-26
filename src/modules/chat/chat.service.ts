import {
  type ArtifactType,
  type ClientType,
  type IntentMode,
  Prisma,
  type ValidationStatus,
} from '@prisma/client';

import { AppError } from '../../shared/errors/app-error.js';
import { sha256 } from '../../shared/crypto/sql-hash.js';
import type { AuditLogInput, AuditRepository } from '../audit/audit.repositories.js';
import type { MetricDefinition } from '../schema-catalog/metric-catalog.js';
import {
  buildBusinessSchemaContext,
  buildFieldLabels,
  buildMetricCatalogContext,
  validateMetricQuery,
} from '../schema-catalog/metric-catalog.js';
import { compileMetricQuery } from '../sql-safety/metric-query-compiler.js';
import type { ReadonlyQueryResult } from '../sql-safety/readonly-query.service.js';
import { validateReadonlySql } from '../sql-safety/sql-safety.js';
import type { EmbeddingProvider } from '../knowledge/embeddings/embedding-provider.js';
import type { KnowledgeRepository } from '../knowledge/knowledge.repositories.js';
import {
  type Citation,
  type KnowledgeChunkRef,
  answerFromKnowledge,
  retrieveKnowledge,
} from '../knowledge/knowledge.service.js';
import type { ArtifactRecord, ChatRepository } from './chat.repositories.js';
import { buildValidatedDynamicChartSpec } from './dynamic-chart.js';
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
  VisualIntent,
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
  audit?: AuditRepository;
  knowledge?: KnowledgeRepository;
  embeddings?: EmbeddingProvider;
};

// Acumulador mutable que las distintas ramas pueblan; se escribe una sola vez por
// request en el finally de handleChatMessage.
type AuditAccumulator = {
  userId: string | null;
  clientType: ClientType;
  path: string;
  question: string;
  traceId: string;
  startedAt: number;
  metric: string | null;
  intentMode: IntentMode | null;
  answerSource: string | null;
  generatedSql: string | null;
  validatedSql: string | null;
  validationStatus: ValidationStatus;
  fallbackReason: string | null;
  missingMetricOrDimension: string | null;
  sourceViews: string[];
  rowCount: number | null;
  retrievedDocIds: string[];
  executionPlan: Prisma.InputJsonValue | null;
};

export type AnswerSource = 'semantic' | 'fallback_sql' | 'knowledge' | 'mixed' | null;

const FALLBACK_WARNING =
  'Respuesta generada con SQL exploratorio fuera del catálogo de métricas; puede ser menos precisa. Verifica antes de tomar decisiones.';

// Scope de la base de conocimiento para el CEO (MVP single-user).
const KNOWLEDGE_ACCESS_SCOPE = 'CEO';

// Mensaje al CEO cuando la ejecucion de la consulta o la persistencia falla. El
// error real se loguea server-side; al usuario no le exponemos detalles internos.
const EXECUTION_ERROR_MESSAGE =
  'No pude completar la consulta sobre los datos en este momento. Por favor, inténtalo de nuevo en unos minutos.';

export type HandleChatInput = {
  // null para llamadas de sistema/service-to-service (MCP): query_audit_log.user_id
  // es nullable y no es FK; el repo stateless ignora el userId.
  userId: string | null;
  message: string;
  conversationId?: string;
  intentMode?: IntentModeInput;
  traceId: string;
  clientType?: ClientType;
  path?: string;
  dynamicChartsEnabled?: boolean;
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
  citations: Citation[];
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
  const audit = createAuditAccumulator(input, intentMode);

  try {
    return await runChatPipeline(deps, input, conversationId, intentMode, audit);
  } finally {
    // Una sola fila de auditoria por request, en cualquier camino. Best-effort:
    // un fallo de auditoria nunca rompe la respuesta al CEO.
    await flushAudit(deps, audit);
  }
}

async function runChatPipeline(
  deps: ChatServiceDeps,
  input: HandleChatInput,
  conversationId: string,
  intentMode: ReturnType<typeof toPrismaIntentMode>,
  audit: AuditAccumulator,
): Promise<ChatResponse> {
  const catalogContext = buildMetricCatalogContext();
  const temporalContext = await getTemporalContext(deps.runQuery);
  // Historial = turnos PREVIOS. Se lee antes de insertar el mensaje actual para
  // no duplicarlo (el mensaje actual se anexa una sola vez, ya delimitado).
  const recentMessages = await deps.repository.listRecentMessages(conversationId);
  // Pista compacta de la base de conocimiento para que el planner pueda rutear a
  // la intencion documental. Si no hay capa de conocimiento configurada, queda vacia.
  const knowledgeBase =
    deps.knowledge !== undefined
      ? await deps.knowledge.listKnowledgeBase(KNOWLEDGE_ACCESS_SCOPE)
      : [];

  await deps.repository.insertMessage({
    conversationId,
    role: 'USER',
    content: input.message,
    intentMode,
    traceId: input.traceId,
  });

  let plan: { query: ReturnType<typeof validateMetricQuery>['query']; metric: MetricDefinition };
  // Sub-pregunta documental cuando el prompt combina metrica + conocimiento.
  let knowledgeLookup: string | null = null;
  let visualIntent: VisualIntent | undefined;

  try {
    const metricPlan = await deps.llm.planMetricQuery(
      input.message,
      catalogContext,
      temporalContext,
      recentMessages,
      knowledgeBase,
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

    if (metricPlan.kind === 'knowledge') {
      return await respondKnowledge(deps, conversationId, input, intentMode, audit);
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
          audit,
        );

        if (fallback !== null) {
          return fallback;
        }
      }

      const clarification =
        metricClarificationForAdvancedVisual(input.message) ?? metricPlan.message;
      audit.missingMetricOrDimension = clarification;
      return await respondClarification(deps, conversationId, input, intentMode, clarification);
    }

    plan = validateMetricQuery(metricPlan.query);
    knowledgeLookup = metricPlan.knowledgeLookup;
    visualIntent = metricPlan.visualIntent;
  } catch {
    // Errores del proveedor LLM o de validacion: aclaracion, no 500.
    audit.fallbackReason = 'planner_or_validation_error';
    return respondClarification(deps, conversationId, input, intentMode);
  }

  // Ejecucion + persistencia: si la DB de analitica falla o no esta disponible,
  // o la persistencia falla, NO devolvemos 500. Logueamos el error real y
  // respondemos con un mensaje claro al CEO.
  try {
    const compiled = compileMetricQuery(plan.query, plan.metric);

    // Despacho en paralelo: la consulta de la metrica y, si el prompt combina con
    // una parte documental, el retrieval de conocimiento corren a la vez.
    const knowledgePromise =
      knowledgeLookup !== null && deps.knowledge !== undefined && deps.embeddings !== undefined
        ? retrieveKnowledge(
            { knowledge: deps.knowledge, embeddings: deps.embeddings },
            { question: knowledgeLookup, accessScope: KNOWLEDGE_ACCESS_SCOPE },
          )
        : Promise.resolve(null);
    const [queryResult, retrieval] = await Promise.all([
      deps.runQuery(compiled.sql),
      knowledgePromise,
    ]);
    const jsonRows = JSON.parse(JSON.stringify(queryResult.rows)) as Prisma.InputJsonValue;
    const fieldLabels = buildFieldLabels(extractColumns(queryResult.rows));
    const combined = retrieval?.hasEvidence === true;

    audit.metric = plan.metric.name;
    audit.answerSource = combined ? 'mixed' : 'semantic';
    audit.generatedSql = compiled.sql;
    audit.validatedSql = queryResult.validatedSql;
    audit.validationStatus = 'VALID';
    audit.sourceViews = queryResult.sourceViews;
    audit.rowCount = queryResult.rows.length;
    audit.retrievedDocIds = retrieval?.documentIds ?? [];
    audit.executionPlan = { metric: plan.metric.name, knowledge_lookup: knowledgeLookup };

    let artifactType = pickArtifactType(plan.metric, queryResult.rows, input.intentMode);
    let chartSpec = buildChartSpec(plan.metric, artifactType, plan.query, fieldLabels);
    const warnings: string[] = [];
    const dynamicVisualInstruction = resolveDynamicVisualInstruction(
      input.message,
      visualIntent,
      queryResult.rows,
    );
    if (
      dynamicVisualInstruction !== null &&
      artifactType !== 'ACTION_PLAN' &&
      !supportsAdvancedVisualDataShape(dynamicVisualInstruction, queryResult.rows)
    ) {
      artifactType = 'TABLE';
      chartSpec = null;
      warnings.push(advancedVisualDataShapeWarning(dynamicVisualInstruction));
    } else if (dynamicVisualInstruction !== null && artifactType !== 'ACTION_PLAN') {
      if (input.dynamicChartsEnabled !== true) {
        artifactType = 'TABLE';
        chartSpec = null;
        warnings.push(
          'La visualización solicitada requiere gráficas dinámicas. Actívalas para generarla; los datos se muestran como tabla.',
        );
      } else {
        try {
          const candidate = await deps.llm.generateDynamicChart({
            question: input.message,
            instruction: dynamicVisualInstruction,
            rows: queryResult.rows,
            fieldLabels,
          });
          chartSpec = buildValidatedDynamicChartSpec(
            candidate,
            queryResult.rows,
          ) as Prisma.InputJsonValue;
          artifactType = 'DYNAMIC_CHART';
        } catch (error) {
          deps.logger?.warn(
            {
              trace_id: input.traceId,
              err: error instanceof Error ? error.message : String(error),
            },
            'analytics.dynamic_chart_generation_failed',
          );
          artifactType = 'TABLE';
          chartSpec = null;
          warnings.push(dynamicChartFailureWarning(error));
        }
      }
    }

    // Si el grafico no es renderizable (sus columnas no estan en los datos), no
    // emitimos un grafico vacio: degradamos un CHART a TABLA (el CEO ve los datos)
    // y, en REPORT, lo dejamos sin grafico (conserva resumen + tabla).
    if (
      artifactType !== 'DYNAMIC_CHART' &&
      chartSpec !== null &&
      !chartColumnsRenderable(chartSpec, queryResult.rows)
    ) {
      chartSpec = null;
      if (artifactType === 'CHART') {
        artifactType = 'TABLE';
      }
    }
    // Narrativa y sugerencias en paralelo. Si hay evidencia documental, la narrativa
    // es una sintesis combinada (metrica + conocimiento con citas).
    const [narrative, suggestedQuestions] = await Promise.all([
      retrieval?.hasEvidence === true
        ? composeCombinedSafe(deps, input, plan, queryResult.rows, retrieval.chunks)
        : composeNarrativeSafe(deps, input, plan, queryResult.rows),
      suggestFollowUpsSafe(deps, {
        question: input.message,
        metricLabel: plan.metric.label,
        rows: queryResult.rows,
        context: describeQueryContext(plan.query),
        catalogContext,
        fieldLabels,
      }),
    ]);
    const citations = retrieval?.citations ?? [];
    if (queryResult.rows.length === 0) {
      warnings.push('La consulta no devolvió filas.');
    }
    if (knowledgeLookup !== null && !combined) {
      warnings.push('No encontré soporte documental para la parte adicional de tu pregunta.');
    }
    const period = derivePeriod(plan.query);
    const freshness = new Date().toISOString();

    // El modo solo cambia COMO se presenta la metrica resuelta, no la metrica.
    let payload: Prisma.InputJsonValue = {
      metric: plan.metric.name,
      rows: jsonRows,
      labels: fieldLabels,
    };

    if (artifactType === 'ACTION_PLAN') {
      const actions = await composePlanSafe(deps, input, plan, queryResult.rows);
      payload = { metric: plan.metric.name, actions, rows: jsonRows, labels: fieldLabels };
    } else if (artifactType === 'REPORT') {
      payload = {
        metric: plan.metric.name,
        summary: narrative,
        rows: jsonRows,
        labels: fieldLabels,
      };
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
      citations,
      metadata: {
        metric: plan.metric.name,
        source_views: queryResult.sourceViews,
        validated_sql: queryResult.validatedSql,
        intent_mode: input.intentMode ?? null,
        answer_source: combined ? 'mixed' : 'semantic',
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

    audit.metric = plan.metric.name;
    audit.validationStatus = 'VALID';
    audit.fallbackReason = 'metric_execution_failed';
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
    citations: [],
    metadata: {
      metric: null,
      source_views: [],
      validated_sql: null,
      intent_mode: input.intentMode ?? null,
      answer_source: null,
    },
  };
}

function createAuditAccumulator(
  input: HandleChatInput,
  intentMode: IntentMode | null,
): AuditAccumulator {
  return {
    userId: input.userId,
    clientType: input.clientType ?? 'WEB',
    path: input.path ?? '/api/chat/messages',
    question: input.message,
    traceId: input.traceId,
    startedAt: Date.now(),
    metric: null,
    intentMode,
    answerSource: null,
    generatedSql: null,
    validatedSql: null,
    validationStatus: 'NOT_APPLICABLE',
    fallbackReason: null,
    missingMetricOrDimension: null,
    sourceViews: [],
    rowCount: null,
    retrievedDocIds: [],
    executionPlan: null,
  };
}

// Escribe la fila de auditoria. Best-effort: si la auditoria falla, se loguea y se
// sigue (nunca rompe la respuesta al CEO).
async function flushAudit(deps: ChatServiceDeps, audit: AuditAccumulator): Promise<void> {
  if (deps.audit === undefined) {
    return;
  }

  const logInput: AuditLogInput = {
    userId: audit.userId,
    clientType: audit.clientType,
    path: audit.path,
    question: audit.question,
    metric: audit.metric,
    intentMode: audit.intentMode,
    answerSource: audit.answerSource,
    generatedSql: audit.generatedSql,
    validatedSql: audit.validatedSql,
    generatedSqlHash: audit.generatedSql === null ? null : sha256(audit.generatedSql),
    validatedSqlHash: audit.validatedSql === null ? null : sha256(audit.validatedSql),
    validationStatus: audit.validationStatus,
    fallbackReason: audit.fallbackReason,
    missingMetricOrDimension: audit.missingMetricOrDimension,
    sourceViews: audit.sourceViews,
    rowCount: audit.rowCount,
    executionPlan: audit.executionPlan,
    retrievedDocIds: audit.retrievedDocIds,
    latencyMs: Date.now() - audit.startedAt,
    traceId: audit.traceId,
  };

  try {
    await deps.audit.insertAuditLog(logInput);
  } catch (error) {
    deps.logger?.error?.(
      {
        trace_id: audit.traceId,
        err: error instanceof Error ? error.message : String(error),
      },
      'audit.write_failed',
    );
  }
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
    citations: [],
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
  const fieldLabels = buildFieldLabels(extractColumns(rows));
  try {
    return await deps.llm.composeNarrative({
      question: input.message,
      metricLabel: plan.metric.label,
      format: plan.metric.format,
      rows,
      context: describeQueryContext(plan.query),
      intentMode: input.intentMode,
      fieldLabels,
    });
  } catch {
    // Si la narrativa LLM falla, no perdemos los datos ya calculados.
    return `${plan.metric.label}: ${String(rows.length)} registro(s) recuperados.`;
  }
}

async function composeCombinedSafe(
  deps: ChatServiceDeps,
  input: HandleChatInput,
  plan: { query: ReturnType<typeof validateMetricQuery>['query']; metric: MetricDefinition },
  rows: unknown[],
  chunks: KnowledgeChunkRef[],
): Promise<string> {
  const fieldLabels = buildFieldLabels(extractColumns(rows));
  try {
    return await deps.llm.composeCombinedAnswer({
      question: input.message,
      metricLabel: plan.metric.label,
      rows,
      context: describeQueryContext(plan.query),
      chunks,
      fieldLabels,
    });
  } catch {
    return `${plan.metric.label}: ${String(rows.length)} registro(s) recuperados.`;
  }
}

async function composePlanSafe(
  deps: ChatServiceDeps,
  input: HandleChatInput,
  plan: { query: ReturnType<typeof validateMetricQuery>['query']; metric: MetricDefinition },
  rows: unknown[],
): Promise<{ title: string; detail: string }[]> {
  const fieldLabels = buildFieldLabels(extractColumns(rows));
  try {
    return await deps.llm.composePlan({
      question: input.message,
      metricLabel: plan.metric.label,
      rows,
      context: describeQueryContext(plan.query),
      fieldLabels,
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
  audit: AuditAccumulator,
): Promise<ChatResponse | null> {
  const candidate = await deps.llm.generateFallbackSql({
    question: input.message,
    schemaContext: buildBusinessSchemaContext(),
    temporalContext,
  });

  if (candidate === null) {
    audit.fallbackReason = 'fallback_no_candidate';
    return null;
  }

  audit.generatedSql = candidate.sql;

  let result: ReadonlyQueryResult;

  try {
    const validated = validateReadonlySql(candidate.sql);
    result = await deps.runQuery(validated.sql);
  } catch {
    // SQL no gobernable o fallo de ejecucion: no exponemos el error, caemos a aclaracion.
    audit.validationStatus = 'REJECTED';
    audit.fallbackReason = 'fallback_sql_rejected';
    return null;
  }

  audit.answerSource = 'fallback_sql';
  audit.validatedSql = result.validatedSql;
  audit.validationStatus = 'VALID';
  audit.sourceViews = result.sourceViews;
  audit.rowCount = result.rows.length;

  deps.logger?.warn(
    {
      trace_id: input.traceId,
      validated_sql: result.validatedSql,
      source_views: result.sourceViews,
    },
    'analytics.fallback_sql_triggered',
  );

  const jsonRows = JSON.parse(JSON.stringify(result.rows)) as Prisma.InputJsonValue;
  const fieldLabels = buildFieldLabels(extractColumns(result.rows));
  let artifactType: ArtifactType = result.rows.length <= 1 ? 'KPI' : 'TABLE';
  let chartSpec: Prisma.InputJsonValue | null = null;
  const warnings = [FALLBACK_WARNING];
  const dynamicVisualInstruction = resolveDynamicVisualInstruction(
    input.message,
    undefined,
    result.rows,
  );

  if (dynamicVisualInstruction !== null && result.rows.length > 0) {
    if (input.dynamicChartsEnabled !== true) {
      warnings.push(
        'La visualización solicitada requiere gráficas dinámicas. Actívalas para generarla; los datos se muestran como tabla.',
      );
    } else if (!supportsAdvancedVisualDataShape(dynamicVisualInstruction, result.rows)) {
      warnings.push(advancedVisualDataShapeWarning(dynamicVisualInstruction));
    } else {
      try {
        const candidateSpec = await deps.llm.generateDynamicChart({
          question: input.message,
          instruction: dynamicVisualInstruction,
          rows: result.rows,
          fieldLabels,
        });
        chartSpec = buildValidatedDynamicChartSpec(
          candidateSpec,
          result.rows,
        ) as Prisma.InputJsonValue;
        artifactType = 'DYNAMIC_CHART';
      } catch (error) {
        deps.logger?.warn(
          {
            trace_id: input.traceId,
            err: error instanceof Error ? error.message : String(error),
          },
          'analytics.fallback_dynamic_chart_generation_failed',
        );
        warnings.push(dynamicChartFailureWarning(error));
      }
    }
  }

  const [narrative, suggestedQuestions] = await Promise.all([
    composeFallbackNarrative(deps, input, result.rows),
    suggestFollowUpsSafe(deps, {
      question: input.message,
      metricLabel: 'Consulta exploratoria',
      rows: result.rows,
      context: '',
      catalogContext,
      fieldLabels,
    }),
  ]);
  const payload: Prisma.InputJsonValue = {
    source: 'fallback_sql',
    rows: jsonRows,
    labels: fieldLabels,
  };

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
    chartSpec,
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
    citations: [],
    metadata: {
      metric: null,
      source_views: result.sourceViews,
      validated_sql: result.validatedSql,
      intent_mode: input.intentMode ?? null,
      answer_source: 'fallback_sql',
    },
  };
}

// Ruta documental (RAG): recupera chunks y sintetiza una respuesta con citas, o
// responde "sin evidencia". Si la capa de conocimiento no esta configurada, aclara.
async function respondKnowledge(
  deps: ChatServiceDeps,
  conversationId: string,
  input: HandleChatInput,
  intentMode: ReturnType<typeof toPrismaIntentMode>,
  audit: AuditAccumulator,
): Promise<ChatResponse> {
  if (deps.knowledge === undefined || deps.embeddings === undefined) {
    return respondClarification(deps, conversationId, input, intentMode);
  }

  audit.answerSource = 'knowledge';

  const result = await answerFromKnowledge(
    { knowledge: deps.knowledge, embeddings: deps.embeddings, llm: deps.llm },
    { question: input.message, accessScope: KNOWLEDGE_ACCESS_SCOPE },
  );

  audit.retrievedDocIds = result.documentIds;
  if (!result.hasEvidence) {
    audit.fallbackReason = 'knowledge_no_evidence';
  }

  const warnings = result.hasEvidence ? [] : ['knowledge_no_evidence'];
  const payload: Prisma.InputJsonValue = { source: 'knowledge', citations: result.citations };

  const assistantMessage = await deps.repository.insertMessage({
    conversationId,
    role: 'ASSISTANT',
    content: result.message,
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
    summary: result.message,
    payload,
    chartSpec: null,
    freshness: new Date().toISOString(),
    warnings,
    traceId: input.traceId,
  });

  return {
    trace_id: input.traceId,
    conversation_id: conversationId,
    message: result.message,
    data: [],
    artifacts: [
      { id: artifactRow.id, type: 'TEXT', summary: result.message, payload, chart_spec: null },
    ],
    chart: null,
    warnings,
    suggested_questions: [...SUGGESTED_QUESTIONS],
    quick_actions: [],
    citations: result.citations,
    metadata: {
      metric: null,
      source_views: [],
      validated_sql: null,
      intent_mode: input.intentMode ?? null,
      answer_source: 'knowledge',
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
      fieldLabels: buildFieldLabels(extractColumns(rows)),
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
  fieldLabels: Record<string, string>,
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
    labels: fieldLabels,
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

function resolveDynamicVisualInstruction(
  question: string,
  visualIntent: VisualIntent | undefined,
  rows: unknown[],
): string | null {
  if (visualIntent?.kind === 'dynamic') {
    if (
      /histogram|histograma|distribution|distribuci[oó]n/iu.test(visualIntent.instruction) &&
      !supportsRealNumericDistribution(question.toLowerCase(), rows)
    ) {
      return null;
    }

    return visualIntent.instruction;
  }

  if (visualIntent?.kind === 'simple') {
    return null;
  }

  const normalized = question.toLowerCase();
  const asksForAdvancedRenderer =
    /heatmap|mapa de calor|scatter|dispersi[oó]n|histogram|histograma|distribution|distribuci[oó]n|facetas?|facets?|capas?|layers?|small multiples|composici[oó]n|composition|combinad[ao]|combined|apilad[ao] normalizad[ao]|normalized stacking|tooltips? ricos?|leyenda|color adicional/iu.test(
      normalized,
    );

  if (!asksForAdvancedRenderer) {
    return null;
  }

  if (
    /histogram|histograma|distribution|distribuci[oó]n/iu.test(normalized) &&
    !supportsRealNumericDistribution(normalized, rows)
  ) {
    return null;
  }

  return question;
}

function supportsRealNumericDistribution(question: string, rows: unknown[]): boolean {
  if (
    /risk|riesgo|estado|status|prioridad|priority|etapa|stage|segmento|segment|industria|industry/iu.test(
      question,
    )
  ) {
    return false;
  }

  return rows.some((row) => {
    if (typeof row !== 'object' || row === null) {
      return false;
    }

    return Object.values(row).some((value) => isNumericValue(value));
  });
}

type DataShape = { dimensions: string[]; measures: string[] };

function inferDataShape(rows: unknown[]): DataShape {
  const columnValues = new Map<string, unknown[]>();

  for (const row of rows) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      continue;
    }

    for (const [column, value] of Object.entries(row)) {
      if (value === null || value === undefined || value === '') {
        continue;
      }

      const values = columnValues.get(column) ?? [];
      values.push(value);
      columnValues.set(column, values);
    }
  }

  const dimensions: string[] = [];
  const measures: string[] = [];

  for (const [column, values] of columnValues) {
    if (values.length === 0) {
      continue;
    }

    const normalized = column.toLowerCase();
    const dimensionByName =
      /month|mes|date|period|fecha|cliente|customer|segment|category|categoria|id|code|codigo|name|nombre/iu.test(
        normalized,
      );
    const measureByName =
      /revenue|ingresos?|mrr|count|cantidad|amount|monto|score|total|sum|hours|horas/iu.test(
        normalized,
      );
    const allNumeric = values.every((value) => isNumericValue(value));

    if (dimensionByName || (!measureByName && !allNumeric)) {
      dimensions.push(column);
    } else if (measureByName || allNumeric) {
      measures.push(column);
    }
  }

  return { dimensions, measures };
}

function supportsAdvancedVisualDataShape(instruction: string, rows: unknown[]): boolean {
  const shape = inferDataShape(rows);

  if (/heatmap|mapa de calor/iu.test(instruction)) {
    return shape.dimensions.length >= 2 && shape.measures.length >= 1;
  }

  if (/histogram|histograma|distribution|distribuci[oó]n/iu.test(instruction)) {
    return supportsRealNumericDistribution(instruction.toLowerCase(), rows);
  }

  if (
    /facetas?|facets?|capas?|layers?|small multiples|composici[oó]n|composition|apilad[ao] normalizad[ao]|normalized stacking/iu.test(
      instruction,
    )
  ) {
    return shape.dimensions.length >= 2 && shape.measures.length >= 1;
  }

  return shape.measures.length >= 1;
}

function advancedVisualDataShapeWarning(instruction: string): string {
  if (/heatmap|mapa de calor/iu.test(instruction)) {
    return 'No pude generar el mapa de calor porque los datos disponibles necesitan al menos dos dimensiones y una medida. Conservé los datos como tabla.';
  }

  if (/histogram|histograma|distribution|distribuci[oó]n/iu.test(instruction)) {
    return 'No pude generar el histograma porque los datos disponibles necesitan una medida numérica real. Conservé los datos como tabla.';
  }

  return 'No pude generar esa visualización avanzada porque los datos disponibles necesitan suficientes dimensiones y una medida. Conservé los datos como tabla.';
}

function metricClarificationForAdvancedVisual(question: string): string | null {
  if (
    !/facetas?|facets?|capas?|layers?|small multiples|composici[oó]n|composition|apilad[ao] normalizad[ao]|normalized stacking|heatmap|mapa de calor|histograma|histogram/iu.test(
      question,
    )
  ) {
    return null;
  }

  if (/ingresos?|revenue|mrr|clientes?|customers?|cantidad|count|monto|amount/iu.test(question)) {
    return null;
  }

  return '¿Qué medida querés visualizar o apilar: ingresos, MRR, clientes, cantidad u otra métrica?';
}

function isNumericValue(value: unknown): boolean {
  return (
    typeof value === 'number' ||
    (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
  );
}

function dynamicChartFailureWarning(error: unknown): string {
  if (
    error instanceof AppError &&
    /require at least|support at most|row|columna|field|filas?/iu.test(error.message)
  ) {
    return 'No pude generar la gráfica dinámica porque los datos disponibles no alcanzan para esa visualización. Conservé los datos como tabla.';
  }

  return 'No pude generar una gráfica dinámica segura. Conservé los datos como tabla.';
}

function derivePeriod(query: ReturnType<typeof validateMetricQuery>['query']): string | null {
  if (query.time_range === undefined) {
    return null;
  }

  return `${query.time_range.from}..${query.time_range.to}`;
}

function extractColumns(rows: unknown[]): string[] {
  const first = rows[0];
  return typeof first === 'object' && first !== null ? Object.keys(first) : [];
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
  dynamicChartsEnabled?: boolean;
  // Lenguaje natural (interpretado por el LLM) o cambio estructurado directo.
  edit: { kind: 'message'; message: string } | { kind: 'structured'; chartSpec: ChartSpec };
};

export type VisualizationResponse =
  | { requires_main_chat: true; reason: string; artifact_id: string }
  | {
      requires_main_chat: false;
      artifact_id: string;
      artifact_type: ArtifactType;
      chart_spec: Prisma.InputJsonValue | null;
      note?: string;
    };

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

  if (!['CHART', 'REPORT', 'DYNAMIC_CHART'].includes(artifact.artifactType)) {
    throw new AppError(
      'Artifact does not support visualization editing.',
      422,
      'ARTIFACT_NOT_VISUAL',
    );
  }

  if (artifact.artifactType === 'DYNAMIC_CHART') {
    if (input.edit.kind !== 'message') {
      throw new AppError(
        'Dynamic charts are edited with a natural-language instruction.',
        422,
        'DYNAMIC_CHART_EDIT_REQUIRES_MESSAGE',
      );
    }

    const rows = extractArtifactRows(artifact);
    const fieldLabels = extractArtifactLabels(artifact, rows);
    const candidate = await deps.llm.editDynamicChart({
      question: 'Editar grafica dinamica existente',
      instruction: input.edit.message,
      editInstruction: input.edit.message,
      rows,
      fieldLabels,
      currentSpec: artifact.chartSpec,
    });
    const chartSpec = buildValidatedDynamicChartSpec(candidate, rows) as Prisma.InputJsonValue;

    await deps.repository.updateArtifactChartSpec(artifact.id, chartSpec);

    return {
      requires_main_chat: false,
      artifact_id: artifact.id,
      artifact_type: 'DYNAMIC_CHART',
      chart_spec: chartSpec,
    };
  }

  const availableColumns = extractArtifactColumns(artifact);

  if (input.edit.kind === 'message') {
    const artifactRows = extractArtifactRows(artifact);
    const dynamicVisualInstruction = resolveDynamicVisualInstruction(
      input.edit.message,
      undefined,
      artifactRows,
    );

    if (dynamicVisualInstruction !== null) {
      if (input.dynamicChartsEnabled !== true) {
        return {
          requires_main_chat: false,
          artifact_id: artifact.id,
          artifact_type: artifact.artifactType,
          chart_spec: artifact.chartSpec as Prisma.InputJsonValue,
          note: 'Activa graficas dinamicas para convertir esta visualizacion avanzada.',
        };
      }

      if (!supportsAdvancedVisualDataShape(dynamicVisualInstruction, artifactRows)) {
        return {
          requires_main_chat: false,
          artifact_id: artifact.id,
          artifact_type: artifact.artifactType,
          chart_spec: artifact.chartSpec as Prisma.InputJsonValue,
          note: advancedVisualDataShapeWarning(dynamicVisualInstruction),
        };
      }

      const artifactLabels = extractArtifactLabels(artifact, artifactRows);
      const candidate = await deps.llm.generateDynamicChart({
        question: input.edit.message,
        instruction: dynamicVisualInstruction,
        rows: artifactRows,
        fieldLabels: artifactLabels,
      });
      const chartSpec = buildValidatedDynamicChartSpec(
        candidate,
        artifactRows,
      ) as Prisma.InputJsonValue;

      await deps.repository.updateArtifactVisualization(artifact.id, {
        artifactType: 'DYNAMIC_CHART',
        chartSpec,
      });

      return {
        requires_main_chat: false,
        artifact_id: artifact.id,
        artifact_type: 'DYNAMIC_CHART',
        chart_spec: chartSpec,
      };
    }
  }

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

  return {
    requires_main_chat: false,
    artifact_id: artifact.id,
    artifact_type: artifact.artifactType,
    chart_spec: chartSpec,
  };
}

function extractArtifactColumns(artifact: ArtifactRecord): string[] {
  return extractColumns(extractArtifactRows(artifact));
}

function extractArtifactRows(artifact: ArtifactRecord): unknown[] {
  const payload = artifact.payload;

  if (typeof payload !== 'object' || payload === null || !('rows' in payload)) {
    return [];
  }

  const rows = (payload as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows : [];
}

function extractArtifactLabels(artifact: ArtifactRecord, rows: unknown[]): Record<string, string> {
  const payload = artifact.payload;

  if (typeof payload === 'object' && payload !== null && 'labels' in payload) {
    const labels = (payload as { labels?: unknown }).labels;
    if (typeof labels === 'object' && labels !== null && !Array.isArray(labels)) {
      return Object.fromEntries(
        Object.entries(labels).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      );
    }
  }

  return buildFieldLabels(extractColumns(rows));
}
