# ADR 0008: Adopt Query Audit Log And Observability

- Date: 2026-06-21
- Status: Accepted

## Context

El pipeline analítico ya circula `trace_id` y emite `warn`
`analytics.fallback_sql_triggered`, pero no había trazabilidad persistente de las
consultas. Con el fallback Text-to-SQL (menos preciso) recién agregado, hace falta
auditar cada pregunta: qué se preguntó, qué SQL se generó/validó, por qué se cayó a
fallback o aclaración, y con qué resultado. La auditoría debe ser un único modelo
reutilizable por la web y, más adelante, por `mirador-mcp`.

## Decision Drivers

- Trazabilidad de cada consulta para gobierno y diagnóstico.
- Una sola fila por request, en todos los caminos (métrico, fallback, aclaración,
  conversacional, error).
- Que un fallo de auditoría nunca rompa la respuesta al CEO.
- Modelo común para web y MCP (`client_type`), forward-compat con RAG.

## Decision

- Tabla `query_audit_log` (modelo `QueryAuditLog`), sin FK a `users` para
  sobrevivir borrados. Campos: `user_id`, `client_type` (`WEB`/`MCP`), `path`,
  `question`, `metric`, `intent_mode`, `answer_source`, `generated_sql`/
  `validated_sql` + sus hashes sha256, `validation_status`
  (`VALID`/`REJECTED`/`NOT_APPLICABLE`), `fallback_reason`,
  `missing_metric_or_dimension`, `source_views`, `row_count`, `execution_plan` y
  `retrieved_doc_ids` (nullable, forward-compat RAG), `latency_ms`, `trace_id`,
  `created_at`. `GRANT SELECT, INSERT` a `mirador_app` (ADR 0003).
- En `handleChatMessage`: acumulador mutable + `try/finally`. Cada rama lo puebla;
  el `finally` escribe **exactamente una** fila. El flush es best-effort
  (try/catch interno; loguea `audit.write_failed` y sigue).
- Hashes de SQL con `node:crypto` (sha256) en `src/shared/crypto/sql-hash.ts`.

## Consequences

### Positive

- Cada consulta queda auditada con su SQL, estado de validación y `trace_id`.
- El modelo soporta `client_type=MCP` sin retrofitear (Fase 8).
- La auditoría no añade un punto de fallo: si falla, la respuesta sigue.

### Negative

- En el MVP single-CEO se persisten `question`/SQL crudos (más hashes); la
  redacción fina de valores sensibles queda para cuando haya multi-rol.
- `execution_plan`/`retrieved_doc_ids` se crean ahora pero se pueblan en Fase 7.

## Implementation Notes

- `client_type` y `path` se inyectan desde la ruta (`WEB`, `/api/chat/messages`).
- El endpoint de visualización (mini-chat) no ejecuta SQL gobernado, así que no se
  audita en esta fase.
- El `warn` `analytics.fallback_sql_triggered` y la exposición de
  `freshness/warnings/source_views/trace_id` en artefactos ya existían.

## Related Decisions

- [ADR 0007: Adopt Governed SQL Fallback With Low-Confidence Signaling](0007-adopt-governed-sql-fallback-with-low-confidence-signaling.md)
- [ADR 0003: Decouple Role And Extension Provisioning From The Schema Migration](0003-decouple-role-and-extension-provisioning-from-schema-migration.md)
- `docs/checkpoints.md`
- `docs/database-model.md`
