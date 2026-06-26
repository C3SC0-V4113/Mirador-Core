import type {
  ChartEditInput,
  ChartEditResult,
  CombinedAnswerInput,
  FallbackSqlInput,
  FollowUpInput,
  KnowledgeAnswerInput,
  LlmProvider,
  MetricCatalogContext,
  MetricPlan,
  NarrativeInput,
  PlanInput,
} from './llm-provider.js';

const VISUAL_CHANGE_PATTERN =
  /barra|barras|linea|línea|line|pastel|pie|torta|area|área|tabla|table|apilad|stacked|color/iu;

const KNOWLEDGE_PATTERN =
  /pol[ií]tica|visi[oó]n|misi[oó]n|valores|proceso|producto|onboarding|documento|manual/iu;

const DYNAMIC_VISUAL_PATTERN =
  /heatmap|mapa de calor|dispersion|dispersi[oó]n|scatter|histogram|histograma|distribution|distribuci[oó]n|faceta|facet|combinad[ao]|doble eje|capas?|layer/iu;

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
      _knowledgeBase?,
    ): Promise<MetricPlan> {
      const normalized = prompt.toLowerCase();
      const match = findMetric(normalized, catalogContext);

      if (match !== undefined) {
        // Combo determinista: si ademas hay una pista documental, adjunta el lookup.
        const knowledgeLookup = KNOWLEDGE_PATTERN.test(normalized) ? prompt : null;
        return Promise.resolve({
          kind: 'metric',
          query: { metric: match },
          knowledgeLookup,
          visualIntent: DYNAMIC_VISUAL_PATTERN.test(normalized)
            ? { kind: 'dynamic', instruction: prompt }
            : { kind: 'default' },
        });
      }

      if (KNOWLEDGE_PATTERN.test(normalized)) {
        return Promise.resolve({ kind: 'knowledge' });
      }

      return Promise.resolve({
        kind: 'clarify',
        message:
          'No pude asociar tu pregunta a una métrica del catálogo. ¿Puedes precisar la métrica o el periodo?',
      });
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

    suggestFollowUps(input: FollowUpInput): Promise<string[]> {
      // Determinista: sugerencias contextuales a la metrica resuelta. Sirve para
      // tests y como fallback sin red; varia segun la etiqueta de la metrica.
      const label = input.metricLabel;
      return Promise.resolve([
        `¿Cómo cambió ${label} respecto al periodo anterior?`,
        `¿Qué factores explican la tendencia de ${label}?`,
        `Genera un plan de acción a partir de ${label}.`,
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

    composeKnowledgeAnswer(input: KnowledgeAnswerInput) {
      if (input.chunks.length === 0) {
        return Promise.resolve('No encontré evidencia documental.');
      }

      const first = input.chunks[0];
      return Promise.resolve(`${first.content} (${first.title}, ${first.locator})`);
    },

    composeCombinedAnswer(input: CombinedAnswerInput) {
      const metricPart = `${input.metricLabel}: ${String(input.rows.length)} registro(s).`;
      const [first] = input.chunks;
      const docPart =
        input.chunks.length === 0
          ? 'Sin soporte documental.'
          : `${first.content} (${first.title}, ${first.locator})`;
      return Promise.resolve(`${metricPart} ${docPart}`);
    },

    generateDynamicChart(input) {
      return Promise.resolve(
        buildStubDynamicSpec(input.rows, input.fieldLabels, input.instruction),
      );
    },

    editDynamicChart(input) {
      if (/url|imagen|javascript|expresion|expression/iu.test(input.editInstruction)) {
        return Promise.resolve({
          ...(typeof input.currentSpec === 'object' && input.currentSpec !== null
            ? input.currentSpec
            : {}),
          data: { url: 'https://example.invalid/data.json' },
        });
      }

      return Promise.resolve(
        buildStubDynamicSpec(input.rows, input.fieldLabels, input.editInstruction),
      );
    },
  };
}

function buildStubDynamicSpec(
  rows: unknown[],
  labels: Record<string, string>,
  instruction: string,
): Record<string, unknown> {
  const first = rows[0];
  const columns = typeof first === 'object' && first !== null ? Object.keys(first) : [];
  const x = columns[0] ?? '';
  const y = columns[1] ?? x;

  if (/heatmap|mapa de calor/iu.test(instruction)) {
    return {
      mark: 'rect',
      encoding: {
        x: { field: x, type: 'ordinal', title: labels[x] ?? x },
        y: { field: y, type: 'ordinal', title: labels[y] ?? y },
        color: { field: y, type: 'quantitative', title: labels[y] ?? y },
        tooltip: columns.map((field) => ({ field, title: labels[field] ?? field })),
      },
    };
  }

  if (/histogram|histograma|distribution|distribuci[oó]n/iu.test(instruction)) {
    return {
      mark: 'bar',
      encoding: {
        x: { field: y, type: 'quantitative', bin: true, title: labels[y] ?? y },
        y: { aggregate: 'count', type: 'quantitative', title: 'Count' },
        tooltip: columns.map((field) => ({ field, title: labels[field] ?? field })),
      },
    };
  }

  return {
    mark: 'point',
    encoding: {
      x: { field: x, type: 'nominal', title: labels[x] ?? x },
      y: { field: y, type: 'quantitative', title: labels[y] ?? y },
      tooltip: columns.map((field) => ({ field, title: labels[field] ?? field })),
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
