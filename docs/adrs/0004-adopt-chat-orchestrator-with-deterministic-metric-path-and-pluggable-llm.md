# ADR 0004: Adopt Chat Orchestrator With Deterministic Metric Path And Pluggable LLM

- Date: 2026-06-09
- Status: Accepted

## Context

Fases 1-5 dejaron lista la fundación, la auth CEO, los datos MVP, el catálogo
semántico y el validador SQL Safety. Sin embargo, dos piezas exigidas por
`docs/architecture/semantic-layer-and-model-strategy.md` no estaban cableadas: el
runtime read-only no se usaba (la app corría sobre `DATABASE_URL_APP`) y faltaba
el compilador determinista de `MetricQuery` a SQL. Fase 6 requiere convertir una
pregunta en lenguaje natural en una métrica gobernada, ejecutarla de forma segura
y devolver artefactos persistidos.

## Decision Drivers

- Mantener el camino principal determinista (catálogo + compilador), no Text-to-SQL libre.
- Aplicar el read-only de PostgreSQL como segunda barrera real, no solo declarativa.
- Aislar al proveedor LLM detrás de una interfaz intercambiable por configuración.
- Permitir que los tests corran sin red ni API key.
- Persistir conversación, mensajes y artefactos para web y futura Core Internal API.

## Decision

Adoptar un orquestador de chat con corte vertical sobre el camino de métricas:

- Cablear un cliente Prisma read-only (`app.prismaReadonly`,
  `DATABASE_URL_READONLY`) y ejecutar el SQL analítico a través de él.
- Añadir `compileMetricQuery` (determinista): proyecta columnas allowlisted de la
  view `ceo_*`, aplica filtros y `time_range`, ordena por la columna temporal y
  pasa por `validateReadonlySql` como segunda barrera. Los valores de filtro se
  escapan como literales Postgres seguros.
- Definir `LlmProvider` con dos implementaciones: `openai` (proveedor inicial,
  salida JSON validada con `metricQuerySchema`) y `stub` determinista para tests
  y arranque sin key. La selección es por `LLM_PROVIDER`.
- Persistir `chat_messages` y `chat_artifacts`; el runtime (`mirador_app`) los
  escribe, el rol read-only no los toca.
- Implementar `POST /api/chat/messages` y `GET /api/chat/conversations`
  autenticados como CEO, devolviendo narrativa, `data`, `artifacts`, `chart`,
  `warnings`, `suggested_questions`, `metadata` y `trace_id`.

## Consequences

### Positive

- El read-only y el compilador determinista quedan operativos end-to-end.
- El proveedor LLM es intercambiable y los tests no dependen de la red.
- Hay persistencia y trazabilidad (`trace_id`, `validated_sql`, `source_views`).

### Negative

- Quedan diferidos: mini-chat de `chart_spec`, artefactos `report`/`action_plan`
  completos, fallback SQL vía LLM y el comportamiento pleno de `intent_mode`.
- `OPENAI_API_KEY` se vuelve obligatorio cuando `LLM_PROVIDER=openai`.
- Cada migración que crea tablas nuevas debe otorgar `GRANT` explícito a
  `mirador_app` (no se heredan de `ALL TABLES`).

## Implementation Notes

- Nuevos env: `LLM_PROVIDER` (default `stub`), `OPENAI_API_KEY` (opcional,
  requerido si `openai`), `ORCHESTRATOR_MODEL`, `LIGHT_MODEL`.
- Migración `add_chat_orchestrator` (modelos/enums) + `grant_chat_tables_to_app`
  (GRANT a `mirador_app`).
- El contenido del usuario se trata como dato en el prompt del planner para
  mitigar prompt-injection.

## Related Decisions

- [ADR 0002: Adopt Local Postgres, CEO Auth, Semantic Catalog And SQL Safety](0002-adopt-local-postgres-auth-semantic-catalog-and-sql-safety.md)
- [ADR 0003: Decouple Role And Extension Provisioning From The Schema Migration](0003-decouple-role-and-extension-provisioning-from-schema-migration.md)
- `docs/architecture/semantic-layer-and-model-strategy.md`
- `docs/checkpoints.md`
