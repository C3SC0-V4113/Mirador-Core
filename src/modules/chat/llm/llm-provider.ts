import { env } from '../../../config/env.js';
import type {
  buildBusinessSchemaContext,
  buildMetricCatalogContext,
} from '../../schema-catalog/metric-catalog.js';
import type { IntentModeInput } from '../chat.schemas.js';
import { createOpenAiLlmProvider } from './openai-llm-provider.js';
import { createStubLlmProvider } from './stub-llm-provider.js';

export type MetricCatalogContext = ReturnType<typeof buildMetricCatalogContext>;
export type BusinessSchemaContext = ReturnType<typeof buildBusinessSchemaContext>;

export type TemporalContext = {
  today: string;
  earliestPeriod: string | null;
  latestPeriod: string | null;
};

export type NarrativeInput = {
  question: string;
  metricLabel: string;
  format: string;
  rows: unknown[];
  context: string;
  intentMode?: IntentModeInput;
};

export type PlanInput = {
  question: string;
  metricLabel: string;
  rows: unknown[];
  context: string;
};

export type PlanAction = { title: string; detail: string };

export type FollowUpInput = {
  question: string;
  metricLabel: string;
  rows: unknown[];
  context: string;
  // Catalogo completo: el modelo necesita saber QUE puede responder cada metrica
  // (dimensiones, filtros) para no proponer preguntas multi-paso o no resolubles.
  catalogContext: MetricCatalogContext;
};

export type ChartSpec = { type: string; x: string | null; y: string };

export type ChartEditInput = {
  message: string;
  currentChartSpec: unknown;
  availableColumns: string[];
};

export type ChartEditResult =
  | { kind: 'visual'; chartSpec: ChartSpec }
  | { kind: 'route_to_main'; reason: string };

export type FallbackSqlInput = {
  question: string;
  schemaContext: BusinessSchemaContext;
  temporalContext: TemporalContext;
};

// Pista compacta de la base de conocimiento (titulos + tipo) para que el planner
// sepa que hay documentacion y pueda rutear a la intencion `knowledge`.
export type KnowledgeBaseHint = { title: string; docType: string };

export type KnowledgeChunkRef = { title: string; locator: string; content: string };

export type KnowledgeAnswerInput = { question: string; chunks: KnowledgeChunkRef[] };

// Sintesis combinada: teje las cifras de una metrica con la evidencia documental
// en una sola respuesta ejecutiva con citas.
export type CombinedAnswerInput = {
  question: string;
  metricLabel: string;
  rows: unknown[];
  context: string;
  chunks: KnowledgeChunkRef[];
};

export type ChatHistoryMessage = { role: 'USER' | 'ASSISTANT'; content: string };

// El planner devuelve un candidato de MetricQuery (a validar aguas abajo) cuando
// la pregunta mapea a una metrica, una aclaracion especifica cuando no, una
// respuesta conversacional para saludos, o `knowledge` para preguntas documentales.
export type MetricPlan =
  | { kind: 'metric'; query: Record<string, unknown>; knowledgeLookup: string | null }
  | { kind: 'clarify'; message: string }
  | { kind: 'conversational'; message: string }
  | { kind: 'knowledge' };

export type LlmProvider = {
  planMetricQuery(
    prompt: string,
    catalogContext: MetricCatalogContext,
    temporalContext: TemporalContext,
    conversationHistory?: ChatHistoryMessage[],
    knowledgeBase?: KnowledgeBaseHint[],
  ): Promise<MetricPlan>;
  composeNarrative(input: NarrativeInput): Promise<string>;
  composePlan(input: PlanInput): Promise<PlanAction[]>;
  suggestFollowUps(input: FollowUpInput): Promise<string[]>;
  editChartSpec(input: ChartEditInput): Promise<ChartEditResult>;
  generateFallbackSql(input: FallbackSqlInput): Promise<{ sql: string } | null>;
  composeKnowledgeAnswer(input: KnowledgeAnswerInput): Promise<string>;
  composeCombinedAnswer(input: CombinedAnswerInput): Promise<string>;
};

export function createLlmProvider(): LlmProvider {
  if (env.LLM_PROVIDER === 'openai') {
    return createOpenAiLlmProvider();
  }

  return createStubLlmProvider();
}
