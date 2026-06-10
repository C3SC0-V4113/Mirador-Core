import type {
  LlmProvider,
  MetricCatalogContext,
  MetricPlan,
  NarrativeInput,
} from './llm-provider.js';

// Proveedor determinista sin red. Mapea la pregunta a una metrica del catalogo por
// coincidencia de nombre, etiqueta o sinonimo. Se usa en tests y como fallback
// cuando no hay proveedor LLM configurado. Ignora el contexto temporal.
export function createStubLlmProvider(): LlmProvider {
  return {
    planMetricQuery(prompt, catalogContext): Promise<MetricPlan> {
      const normalized = prompt.toLowerCase();
      const match = findMetric(normalized, catalogContext);

      if (match === undefined) {
        return Promise.resolve({
          kind: 'clarify',
          message:
            'No pude asociar tu pregunta a una métrica del catálogo. ¿Puedes precisar la métrica o el periodo?',
        });
      }

      return Promise.resolve({ kind: 'metric', query: { metric: match } });
    },

    composeNarrative(input: NarrativeInput) {
      if (input.rows.length === 0) {
        return Promise.resolve(
          `No se encontraron datos para "${input.metricLabel}" con los filtros indicados.`,
        );
      }

      return Promise.resolve(
        `${input.metricLabel}: ${String(input.rows.length)} registro(s) recuperados para la pregunta "${input.question}".`,
      );
    },
  };
}

function findMetric(normalizedPrompt: string, catalogContext: MetricCatalogContext) {
  for (const metric of catalogContext.metrics) {
    const needles = [metric.name, metric.label, ...metric.synonyms].map((value) =>
      value.toLowerCase(),
    );

    if (needles.some((needle) => normalizedPrompt.includes(needle))) {
      return metric.name;
    }
  }

  return undefined;
}
