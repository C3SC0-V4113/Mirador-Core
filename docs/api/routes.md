# Rutas Base

## Public routes

| Method | Path                                            | Estado                 |
| ------ | ----------------------------------------------- | ---------------------- |
| `GET`  | `/health`                                       | Implementada           |
| `POST` | `/api/auth/login`                               | Implementada           |
| `POST` | `/api/auth/logout`                              | Implementada           |
| `GET`  | `/api/auth/session`                             | Implementada           |
| `POST` | `/api/chat/messages`                            | Implementada protegida |
| `GET`  | `/api/chat/conversations`                       | Implementada protegida |
| `POST` | `/api/chat/artifacts/:artifactId/visualization` | Implementada protegida |
| `GET`  | `/api/schema/catalog`                           | Implementada protegida |

`/api/auth/login` setea la cookie `mirador_session` con `HttpOnly` y
`SameSite=Lax`. Las rutas de chat requieren una sesion CEO valida.

`/api/chat/messages` acepta `{ message, conversation_id?, intent_mode? }` y
devuelve narrativa, `data`, `artifacts`, `chart`, `warnings`,
`suggested_questions`, `quick_actions`, `metadata` y `trace_id`. El `intent_mode`
(`responder`, `analizar`, `reporte_visual`, `plan`) moldea la salida sin descartar
lo pedido en el prompt.

`metadata.answer_source` indica el origen de la respuesta: `semantic` (camino
determinista del catalogo), `fallback_sql` (SQL exploratorio gobernado, viene con
una alerta de baja confianza en `warnings`), `knowledge` (respuesta documental RAG,
trae `citations`), `mixed` (respuesta combinada metrica + conocimiento: artefacto de
la metrica + narrativa documental con `citations` en un solo turno) o `null`
(aclaracion/conversacional). El fallback se desactiva con
`FALLBACK_SQL_ENABLED=false`. Ver
[ADR 0007](../adrs/0007-adopt-governed-sql-fallback-with-low-confidence-signaling.md).

Cuando el prompt combina una metrica y una pregunta documental (p.ej. "¿como varió
el MRR y que dice la politica de delivery?"), el orquestador despacha ambas
subtareas en paralelo y sintetiza una sola respuesta (`answer_source='mixed'`). La
auditoria registra `execution_plan = { metric, knowledge_lookup }` y los
`retrieved_doc_ids`. Si la parte documental no encuentra evidencia, degrada a la
metrica sola con un aviso y `answer_source='semantic'`. Ver
[ADR 0010](../adrs/0010-adopt-multi-intent-execution-plan-combining-metric-and-knowledge.md).

Para preguntas documentales, la respuesta incluye `citations`
(`{ document_id, title, locator }[]`); si no hay evidencia, devuelve un aviso y
`citations` vacio. Embeddings via `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`. Ver
[ADR 0009](../adrs/0009-adopt-knowledge-layer-rag-retrieval-with-citations.md).

`/api/chat/artifacts/:artifactId/visualization` (mini-chat) edita solo el
`chart_spec` de un artefacto ya generado, sin re-consultar. Si el pedido cambia
datos/periodo/metrica/fuente, responde `{ requires_main_chat: true, reason }` para
derivar al chat principal. Ver
[ADR 0006](../adrs/0006-complete-chat-intent-modes-rich-artifacts-and-chart-mini-chat.md).

`/api/schema/catalog` devuelve un catalogo semantico compacto para el rol CEO. No
expone DDL crudo, tablas internas ni `source_view`.

## Internal routes

| Method | Path                            | Consumidor                       |
| ------ | ------------------------------- | -------------------------------- |
| `POST` | `/internal/core/ask`            | `mirador-mcp` o servicio interno |
| `GET`  | `/internal/core/schema-catalog` | `mirador-mcp` o servicio interno |

Estas rutas requieren:

```text
Authorization: Bearer <CORE_SERVICE_TOKEN>
```

Si `CORE_SERVICE_TOKEN` no esta configurado, responden
`503 INTERNAL_CORE_NOT_CONFIGURED`. Con token ausente o invalido responden
`401 INTERNAL_CORE_UNAUTHORIZED`.

`POST /internal/core/ask` ejecuta el MISMO pipeline gobernado que el chat web (capa
semantica, SQL Safety, read-only, fallback, conocimiento, auditoria). Body:
`{ question: string, intent_mode?: ... }` (sin `conversation_id`: las llamadas son
one-shot, sin estado). No persiste `Conversation`/`ChatMessage`; audita una fila con
`client_type='MCP'` y `path='/internal/core/ask'`.

A diferencia del chat web, NO devuelve el `ChatResponse` (acoplado al frontend:
`artifacts` con payload de render, `chart_spec`, `quick_actions`, `intent_mode`).
Devuelve un contrato data-first `CoreAskResult`, agnostico de UI:

```text
{
  trace_id, answer, answer_source, metric, data,
  source_views, validated_sql,
  chart_hint: { type, x, y } | null,   // hint de grafica neutral y portable
  citations, warnings, suggested_questions
}
```

`GET /internal/core/schema-catalog` devuelve el `BusinessSchemaContext` allowlisted.

Las tools MCP del producto se sirven como facetas de estas dos rutas:
`ask_company_data`→`ask`; `describe_business_schema`→`schema-catalog`;
`run_readonly_query`→`validated_sql`+`data`; `generate_chart_spec`→`chart_hint`;
`search_company_knowledge`→`citations`; `suggest_executive_questions`→
`suggested_questions`. Ver
[ADR 0011](../adrs/0011-expose-governed-core-pipeline-via-internal-service-to-service-api.md).

`CORE_INTERNAL_URL` es el hostname interno (Railway) que `mirador-mcp` usa para
alcanzar al core; lo consume el MCP, no `mirador-core`.

## Borde de produccion

En produccion las rutas publicas `/api/*` entran por el Web API Gateway de Cloudflare,
que inyecta el header `x-mirador-origin: <CLOUDFLARE_ORIGIN_SECRET>`. El origin guard
rechaza con `403 ORIGIN_FORBIDDEN` cualquier request a `/api/*` que no lo traiga
(anti-bypass del origen Railway). `/health` y `/internal/*` quedan exentos: el primero
lo usa el healthcheck interno; el segundo viaja por la red privada de Railway. Las
llamadas a OpenAI salen por el AI Gateway de Cloudflare cuando `OPENAI_BASE_URL` esta
configurada. Ver [ADR 0012](../adrs/0012-adopt-railway-cloudflare-deployment-topology.md)
y `docs/deploy/railway-cloudflare.md`.
