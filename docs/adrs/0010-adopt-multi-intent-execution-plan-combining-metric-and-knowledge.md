# ADR 0010: Adopt Multi-Intent Execution Plan (Combining Metric And Knowledge)

- Date: 2026-06-22
- Status: Accepted

## Context

Hasta ahora el chat era estrictamente de una intención: el planner devolvía
métrica O conocimiento O conversacional O aclaración, y el orquestador ruteaba a un
solo camino. Pero el CEO hace preguntas combinadas en una sola frase: "¿cómo varió
el MRR y qué dice la política de delivery sobre proyectos en riesgo?". Antes eso
forzaba dos turnos. Este corte (Fase 7, Corte 2) añade un `execution_plan` que
permite combinar **métrica + conocimiento** en paralelo y sintetizar **una sola
respuesta** con el artefacto de la métrica y la narrativa documental citada. El
camino single-intent ya afinado (ADR 0004–0009) se mantiene intacto.

## Decision Drivers

- Responder preguntas que combinan cifra y documento en un solo turno.
- No reescribir ni degradar los caminos single-intent ya estabilizados.
- Mantener la frontera de gobierno: la métrica sigue por el compilador determinista,
  el documento sigue tratado como dato (`<context>`, anti-injection).
- Señalizar la procedencia mixta para la auditoría y el frontend.

## Decision

- **Contrato `execution_plan` de bajo riesgo:** en vez de reescribir el planner, se
  extiende `MetricPlan`. La variante `metric` gana `knowledgeLookup: string | null`.
  Cuando el prompt combina métrica y documento, el planner devuelve la métrica normal
  **y** `knowledge_query` con la sub-pregunta documental. `knowledge`, `clarify` y
  `conversational` no cambian.
- **Despacho en paralelo:** en la rama métrica del orquestador, si hay
  `knowledgeLookup` y la capa de conocimiento está configurada, se ejecutan en
  `Promise.all` el SQL de la métrica y el retrieval documental (`retrieveKnowledge`,
  solo recuperación sin sintetizar).
- **Síntesis única:** un nuevo método `composeCombinedAnswer({ question, metricLabel,
rows, chunks })` teje las cifras con la evidencia y **cita** documento/locator. La
  respuesta lleva el **artefacto de la métrica** (chart/kpi/table, igual que hoy) +
  `message` combinado + `citations`, con `metadata.answer_source = 'mixed'`.
- **Degradación segura:** si el retrieval no encuentra evidencia que supere el umbral,
  se responde solo la métrica (`answer_source = 'semantic'`) con un aviso de que no
  hubo soporte documental para la parte adicional. Nunca se inventa cita.
- **Auditoría:** `AnswerSource` gana `'mixed'`. El acumulador persiste
  `execution_plan = { metric, knowledge_lookup }` (antes siempre null) y los
  `retrieved_doc_ids` ya poblados por el retrieval.

## Consequences

### Positive

- Preguntas combinadas se resuelven en un solo turno con una respuesta coherente.
- Reutiliza el compilador de métricas y el retrieval existentes; cero cambios en los
  caminos puros.
- La auditoría ya distingue `mixed` y registra el plan ejecutado.

### Negative

- El planner debe decidir bien cuándo una pregunta es combinada; un falso positivo
  añade un retrieval extra (se degrada con aviso, sin romper la respuesta).
- La síntesis combinada es una llamada LLM adicional respecto al camino métrico puro.

## Implementation Notes

- `retrieveKnowledge` se extrajo de `answerFromKnowledge` para recuperar chunks +
  citations sin sintetizar; el camino documental puro sigue usando
  `answerFromKnowledge`.
- La narrativa combinada solo se activa cuando `retrieval.hasEvidence === true`; en
  caso contrario degrada a `composeNarrative` (métrica sola).
- `execution_plan` deja de estar reservado y se llena en el camino métrico.

## Related Decisions

- [ADR 0008: Adopt Query Audit Log And Observability](0008-adopt-query-audit-log-and-observability.md)
- [ADR 0009: Adopt Knowledge Layer (RAG Retrieval With Citations)](0009-adopt-knowledge-layer-rag-retrieval-with-citations.md)
- `docs/checkpoints.md`
