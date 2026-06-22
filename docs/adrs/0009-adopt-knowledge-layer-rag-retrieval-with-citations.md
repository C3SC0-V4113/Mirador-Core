# ADR 0009: Adopt Knowledge Layer (RAG Retrieval With Citations)

- Date: 2026-06-22
- Status: Accepted

## Context

El chat respondía solo métricas (catálogo + fallback SQL). Faltaba el camino
documental: preguntas no-métricas (visión, misión, políticas, procesos, productos)
que se responden recuperando texto de una base de conocimiento. `pgvector` ya
estaba habilitado. Este corte añade la capa de conocimiento end-to-end con citas;
la orquestación multi-intención (mezclar métrica + conocimiento en una sola
respuesta) queda para un corte posterior, y la ingesta como servicio es Fase 10.

## Decision Drivers

- Responder preguntas documentales con evidencia citada, sin inventar.
- Tratar el contenido recuperado como dato, no como instrucción (anti-injection).
- Reusar la misma frontera de gobierno (rol `mirador_app`, auditoría).
- Embeddings intercambiables por configuración, con stub determinista para tests.

## Decision

- Modelos `documents` y `document_chunks` (chunk con `embedding vector(1536)`).
  El índice HNSW (`vector_cosine_ops`) y los `GRANT` a `mirador_app` se añaden en
  la migración (ADR 0003). Las columnas `Unsupported(vector)` se leen/escriben con
  SQL parametrizado (`$1::vector`), no por el cliente tipado.
- `EmbeddingProvider` (`openai` con `text-embedding-3-small` 1536, o `stub`
  determinista). Env `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`; al cambiar el modelo
  hay que reingestar (los vectores viejos quedan en otro espacio).
- Retrieval top-k por similitud coseno filtrado por `access_scope` y `status`.
  `answerFromKnowledge` sintetiza con **citas** (documento + locator) o responde
  **"sin evidencia"** cuando ningún chunk supera el umbral.
- El planner gana la intención `knowledge`: clasifica preguntas documentales con la
  ayuda de un `KnowledgeBaseContext` compacto. El orquestador responde con
  `metadata.answer_source = 'knowledge'`, `citations[]`, y audita
  `retrieved_doc_ids`.
- Ingesta dev por script (`npm run knowledge:ingest`) con docs de ejemplo; el
  servicio asíncrono es Fase 10.

## Consequences

### Positive

- El chat responde preguntas documentales con evidencia y citas.
- El contenido recuperado se delimita (`<context>`) y se trata como dato.
- La auditoría (Fase 9) ya registra el camino `knowledge` y sus documentos.

### Negative

- La calidad del retrieval depende de embeddings reales; con `stub` los vectores
  no son semánticos (solo para tests/arranque sin key).
- No hay aún mezcla métrica+conocimiento en una respuesta (corte siguiente).
- La ingesta es manual (script), no un servicio.

## Implementation Notes

- Knowledge tables escritas/leídas por `mirador_app`; el rol read-only no las toca.
- `retrieved_doc_ids` se persiste en `query_audit_log`; `execution_plan` sigue
  reservado para la orquestación multi-intención.

## Related Decisions

- [ADR 0007: Adopt Governed SQL Fallback With Low-Confidence Signaling](0007-adopt-governed-sql-fallback-with-low-confidence-signaling.md)
- [ADR 0008: Adopt Query Audit Log And Observability](0008-adopt-query-audit-log-and-observability.md)
- `docs/architecture/rag-knowledge-layer.md`
- `docs/checkpoints.md`
