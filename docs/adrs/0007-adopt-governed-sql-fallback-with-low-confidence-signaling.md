# ADR 0007: Adopt Governed SQL Fallback With Low-Confidence Signaling

- Date: 2026-06-20
- Status: Accepted

## Context

El diseño (`docs/architecture/semantic-layer-and-model-strategy.md`) define un
fallback Text-to-SQL gobernado para preguntas exploratorias fuera del catálogo de
métricas. Hasta ahora solo existía la mitad de seguridad (`validateReadonlySql`,
`buildBusinessSchemaContext`, rol read-only) pero nada generaba SQL candidato:
cuando el catálogo no cubría la pregunta, el chat solo aclaraba. Text-to-SQL es
menos preciso que el camino determinista, así que su uso debe ser visible.

## Decision Drivers

- Cubrir preguntas exploratorias sin abrir SQL libre sin gobierno.
- Reusar las mismas barreras (SQL Safety + read-only) que el camino determinista.
- Señalar claramente la menor confianza de las respuestas por fallback.
- Poder desactivar el fallback por configuración.

## Decision

- Nuevo paso `generateFallbackSql` en el proveedor LLM: cuando el planner no
  resuelve métrica, propone UN `SELECT` de solo lectura sobre las views `ceo_*`,
  que pasa por `validateReadonlySql` + `runReadonlyQuery`. Cualquier fallo de
  gobernanza cae a la aclaración de siempre (nunca 500, nunca expone el SQL).
- El allowlist de SQL Safety se amplía a la **superficie completa de las views
  `ceo_*`** (no solo las columnas referenciadas por métricas), definida en
  `config/business-schema.json` y cargada por `buildBusinessSchemaContext`. El
  camino determinista usa un subconjunto, así que sigue válido.
- **Señal de confianza**: toda respuesta por fallback lleva
  `metadata.answer_source = 'fallback_sql'` y una alerta legible en `warnings`
  ("...puede ser menos precisa, verifica antes de decidir"). El camino métrico
  reporta `'semantic'`.
- Observabilidad: log `warn` `analytics.fallback_sql_triggered` (la tabla
  `query_audit_log` completa queda para Fase 9).
- Activo por defecto, desactivable con `FALLBACK_SQL_ENABLED=false`.

## Consequences

### Positive

- El chat responde preguntas fuera del catálogo manteniendo el gobierno.
- La menor precisión es explícita para el frontend y el CEO.
- Reutiliza el SQL Safety Layer y el rol read-only existentes.

### Negative

- Se amplía la superficie gobernada (todas las columnas de las views `ceo_*`); el
  contrato `business-schema.json` debe mantenerse alineado con las views.
- Cada fallback agrega una llamada LLM y depende de la calidad del SQL generado.

## Implementation Notes

- El texto del usuario va delimitado (`<user>`) en el prompt de generación, igual
  que el planner, para mitigar prompt-injection.
- `business-schema.json` es ahora el origen del allowlist del validador y del
  contexto de fallback; reemplaza la derivación desde métricas.

## Related Decisions

- [ADR 0002: Adopt Local Postgres, CEO Auth, Semantic Catalog And SQL Safety](0002-adopt-local-postgres-auth-semantic-catalog-and-sql-safety.md)
- [ADR 0004: Adopt Chat Orchestrator With Deterministic Metric Path And Pluggable LLM](0004-adopt-chat-orchestrator-with-deterministic-metric-path-and-pluggable-llm.md)
- `docs/architecture/semantic-layer-and-model-strategy.md`
- `docs/checkpoints.md`
