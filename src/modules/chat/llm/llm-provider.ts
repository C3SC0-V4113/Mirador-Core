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

export type ChatHistoryMessage = { role: 'USER' | 'ASSISTANT'; content: string };

// El planner devuelve un candidato de MetricQuery (a validar aguas abajo) cuando
// la pregunta mapea a una metrica, una aclaracion especifica cuando no, o una
// respuesta conversacional para saludos/presentaciones/preguntas no comerciales.
export type MetricPlan =
  | { kind: 'metric'; query: Record<string, unknown> }
  | { kind: 'clarify'; message: string }
  | { kind: 'conversational'; message: string };

export type LlmProvider = {
  planMetricQuery(
    prompt: string,
    catalogContext: MetricCatalogContext,
    temporalContext: TemporalContext,
    conversationHistory?: ChatHistoryMessage[],
  ): Promise<MetricPlan>;
  composeNarrative(input: NarrativeInput): Promise<string>;
  composePlan(input: PlanInput): Promise<PlanAction[]>;
  editChartSpec(input: ChartEditInput): Promise<ChartEditResult>;
  generateFallbackSql(input: FallbackSqlInput): Promise<{ sql: string } | null>;
};

export function createLlmProvider(): LlmProvider {
  if (env.LLM_PROVIDER === 'openai') {
    return createOpenAiLlmProvider();
  }

  return createStubLlmProvider();
}
