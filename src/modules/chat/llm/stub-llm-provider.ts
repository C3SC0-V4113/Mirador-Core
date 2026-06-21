import type {
  ChartEditInput,
  ChartEditResult,
  FallbackSqlInput,
  LlmProvider,
  MetricCatalogContext,
  MetricPlan,
  NarrativeInput,
  PlanInput,
} from './llm-provider.js';

const VISUAL_CHANGE_PATTERN =
  /barra|barras|linea|línea|line|pastel|pie|torta|area|área|tabla|table|apilad|stacked|color/iu;

// Proveedor determinista sin red. Mapea la pregunta a una metrica del catalogo por
// coincidencia de nombre, etiqueta o sinonimo. Se usa en tests y como fallback
// cuando no hay proveedor LLM configurado. Ignora el contexto temporal y el historial.
export function createStubLlmProvider(): LlmProvider {
  return {
    planMetricQuery(
      prompt,
      catalogContext,
      _temporalContext?,
      _conversationHistory?,
    ): Promise<MetricPlan> {
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

    composePlan(input: PlanInput) {
      return Promise.resolve([
        {
          title: `Revisar ${input.metricLabel}`,
          detail: `Analiza los ${String(input.rows.length)} registros recuperados y prioriza los casos extremos.`,
        },
        {
          title: 'Definir responsables',
          detail: 'Asigna dueños y fechas para las acciones derivadas de la métrica.',
        },
      ]);
    },

    editChartSpec(input: ChartEditInput): Promise<ChartEditResult> {
      const normalized = input.message.toLowerCase();

      if (!VISUAL_CHANGE_PATTERN.test(normalized)) {
        return Promise.resolve({
          kind: 'route_to_main',
          reason: 'El cambio solicitado afecta datos; usa el chat principal.',
        });
      }

      const current =
        typeof input.currentChartSpec === 'object' && input.currentChartSpec !== null
          ? (input.currentChartSpec as { x?: unknown; y?: unknown })
          : {};
      const type = /barra|barras|stacked|apilad/u.test(normalized)
        ? 'bar'
        : /pastel|pie|torta/u.test(normalized)
          ? 'pie'
          : /tabla|table/u.test(normalized)
            ? 'table'
            : /area|área/u.test(normalized)
              ? 'area'
              : 'line';

      return Promise.resolve({
        kind: 'visual',
        chartSpec: {
          type,
          x: typeof current.x === 'string' ? current.x : null,
          y: typeof current.y === 'string' ? current.y : (input.availableColumns[0] ?? ''),
        },
      });
    },

    generateFallbackSql(input: FallbackSqlInput) {
      // Determinista para tests: solo "pagadores/paying" produce un SELECT valido
      // sobre una columna real no expuesta como metrica; el resto no es respondible.
      const normalized = input.question.toLowerCase();

      if (/pagador|paying/u.test(normalized)) {
        return Promise.resolve({
          sql: 'SELECT period_month, paying_customers FROM ceo_revenue_summary LIMIT 100',
        });
      }

      return Promise.resolve(null);
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
