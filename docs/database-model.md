# Modelo De Datos Inicial

El scaffold incluye un modelo minimo `Conversation` para validar la configuracion de
Prisma y dejar el punto de entrada de migraciones.

## Modelo futuro esperado

- `users`
- `sessions`
- `conversations`
- `chat_messages`
- `chat_artifacts`
- `query_audit_logs`
- `documents`
- `document_chunks`
- views `ceo_*` para metricas ejecutivas

## Principios

- Runtime con usuario PostgreSQL read-only para consultas analiticas.
- Migraciones con credencial separada.
- `pgvector` para RAG documental.
- Auditoria vinculada a `trace_id`.
- No exponer tablas internas por catalogos publicos.
