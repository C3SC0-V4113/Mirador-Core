# ADR 0006: Complete Chat — Intent Modes, Rich Artifacts And Chart Mini-Chat

- Date: 2026-06-10
- Status: Accepted

## Context

El corte vertical de chat (ADR 0004/0005) resolvía métricas y conversación, pero
dejó pendientes de Fase 6: `intent_mode` se persistía pero no cambiaba la salida;
los tipos de artefacto `REPORT` y `ACTION_PLAN` existían en el enum pero nunca se
producían; y no había forma de editar la visualización de una gráfica ya generada.

## Decision Drivers

- Honrar `intent_mode` sin descartar lo pedido en el prompt.
- Producir artefactos ejecutivos (`report`, `action_plan`) reutilizando los datos
  ya gobernados, sin abrir Text-to-SQL libre.
- Permitir ajustar la visualización sin re-consultar, manteniendo el SQL Safety
  fuera del camino visual.

## Decision

- `intent_mode` moldea la presentación de la métrica ya resuelta:
  `responder` (conciso), `analizar` (narrativa más profunda), `reporte_visual`
  (artefacto `REPORT` con `chart_spec`), `plan` (artefacto `ACTION_PLAN` con
  acciones generadas por el LLM). La métrica sigue saliendo del prompt.
- Nuevos métodos del proveedor: `composePlan` (acciones) y `editChartSpec`
  (clasifica visual vs cambio de datos); el `stub` los implementa de forma
  determinista para tests.
- Mini-chat de gráficas: `POST /api/chat/artifacts/:artifactId/visualization`
  edita solo `chart_spec` de un artefacto del propio CEO. Si el pedido cambia
  datos/periodo/métrica/fuente, responde `requires_main_chat` y deriva al chat
  principal. La edición valida tipo contra una allowlist
  (`line, bar, stacked_bar, area, pie, table`) y los ejes contra las columnas
  reales del artefacto.
- `quick_actions` deterministas en la respuesta del chat.

## Consequences

### Positive

- Fase 6 queda completa: los 4 modos cambian la salida y se producen los 6 tipos
  de artefacto.
- El mini-chat habilita iteración visual barata (incluye "pastel") sin re-query.
- La separación se mantiene: el camino visual no toca el SQL Safety Layer.

### Negative

- `intent_mode='plan'` y la edición visual agregan una llamada LLM cada una.
- La ownership del artefacto se valida por la relación `conversation.userId`;
  depende de que el artefacto pertenezca a una conversación del usuario.

## Implementation Notes

- Sin migración: `chartSpec` ya existía en `ChatArtifact`.
- `editChartSpec` recibe el texto del usuario delimitado (`<user>`), igual que el
  planner, para mitigar prompt-injection.
- Ejes fuera de las columnas del artefacto se recortan al `chart_spec` actual en
  vez de persistir ejes inexistentes.

## Related Decisions

- [ADR 0004: Adopt Chat Orchestrator With Deterministic Metric Path And Pluggable LLM](0004-adopt-chat-orchestrator-with-deterministic-metric-path-and-pluggable-llm.md)
- [ADR 0005: Extend Planner With Temporal Context, Clarification Protocol And Per-Customer Revenue](0005-extend-planner-with-temporal-context-and-clarification-protocol.md)
- `docs/checkpoints.md`
- `docs/api/routes.md`
