import type { AnswerSource, ChatResponse } from '../chat/chat.service.js';
import type { ChartSpec } from '../chat/llm/llm-provider.js';
import type { Citation } from '../knowledge/knowledge.service.js';

// Contrato de respuesta service-to-service para /internal/core/ask. Es data-first y
// agnostico de UI: a diferencia del ChatResponse del chat web, NO expone artefactos
// con payload de render, quick_actions ni intent_mode (instrucciones del frontend
// propio). Un MCP lo consume cualquier agente generico, asi que solo entrega datos,
// gobierno (metric, source_views, validated_sql), grounding (citations) y un hint de
// grafica neutral y portable.
export type ChartHint = ChartSpec;

export type CoreAskResult = {
  trace_id: string;
  answer: string;
  answer_source: AnswerSource;
  metric: string | null;
  data: unknown[];
  source_views: string[];
  validated_sql: string | null;
  chart_hint: ChartHint | null;
  citations: Citation[];
  warnings: string[];
  suggested_questions: string[];
};

// Proyecta el ChatResponse interno al contrato MCP, descartando lo especifico del
// frontend (conversation_id, artifacts, quick_actions, intent_mode).
export function toCoreAskResult(response: ChatResponse): CoreAskResult {
  return {
    trace_id: response.trace_id,
    answer: response.message,
    answer_source: response.metadata.answer_source,
    metric: response.metadata.metric,
    data: response.data,
    source_views: response.metadata.source_views,
    validated_sql: response.metadata.validated_sql,
    // response.chart ya es el ChartSpec neutral ({type, x, y}) o null.
    chart_hint: (response.chart as ChartHint | null) ?? null,
    citations: response.citations,
    warnings: response.warnings,
    suggested_questions: response.suggested_questions,
  };
}
