import { env } from '../../../config/env.js';
import type { buildMetricCatalogContext } from '../../schema-catalog/metric-catalog.js';
import { createOpenAiLlmProvider } from './openai-llm-provider.js';
import { createStubLlmProvider } from './stub-llm-provider.js';

export type MetricCatalogContext = ReturnType<typeof buildMetricCatalogContext>;

export type NarrativeInput = {
  question: string;
  metricLabel: string;
  format: string;
  rows: unknown[];
};

// El planificador devuelve un candidato de MetricQuery (sin validar) o null cuando
// la pregunta no mapea a ninguna metrica del catalogo. La validacion estricta vive
// en validateMetricQuery, aguas abajo.
export type LlmProvider = {
  planMetricQuery(
    prompt: string,
    catalogContext: MetricCatalogContext,
  ): Promise<Record<string, unknown> | null>;
  composeNarrative(input: NarrativeInput): Promise<string>;
};

export function createLlmProvider(): LlmProvider {
  if (env.LLM_PROVIDER === 'openai') {
    return createOpenAiLlmProvider();
  }

  return createStubLlmProvider();
}
