# ADR 0011: Expose The Governed Core Pipeline Via An Internal Service-To-Service API

- Date: 2026-06-22
- Status: Accepted

## Context

`mirador-mcp` es un servicio MCP separado (vive fuera de Fastify). No tiene acceso a
la base de datos ni a llaves LLM: su única vía a los datos del negocio es llamar
service-to-service a `/internal/core/*` con `CORE_SERVICE_TOKEN`. El principio rector
del producto es que exista **una sola** capa semántica, SQL Safety Layer, rol
read-only y auditoría — todo en `mirador-core`. `mirador-mcp` solo orquesta tools y
delega; no duplica gobierno.

Estado previo: el guard de token y `GET /internal/core/schema-catalog` ya existían;
`POST /internal/core/ask` era un stub `foundation_only`. Este corte (Fase 8) lo
implementa reusando el pipeline del chat web.

## Decision Drivers

- Reusar el pipeline gobernado completo sin duplicar capa semántica/SQL Safety/audit.
- Las llamadas del MCP son one-shot, sin estado: no deben crear hilos de conversación.
- El consumidor es cualquier agente genérico (no solo el frontend propio): el contrato
  debe ser data-first y agnóstico de UI.
- Mantener la auditoría unificada distinguiendo el origen (`clientType=MCP`).

## Decision

- **Reuso del pipeline:** `POST /internal/core/ask` invoca el mismo
  `handleChatMessage` que el chat web, con las mismas dependencias gobernadas
  (`createLlmProvider`, `runReadonlyQuery`, fallback, knowledge, embeddings, audit).
  `clientType='MCP'`, `path='/internal/core/ask'`, `userId=null`.
- **Stateless:** se inyecta `createStatelessChatRepository()`, un repositorio no-op que
  cumple el contrato `ChatRepository` devolviendo ids sintéticos sin escribir en DB.
  Así las llamadas del MCP no crean `Conversation`/`ChatMessage` y no contaminan la
  lista de hilos de la web del CEO. La auditoría sí registra (una fila, `clientType=MCP`).
  `HandleChatInput.userId` se relajó a `string | null`: `query_audit_log.user_id` es
  nullable y no es FK, pensado para llamadas de sistema.
- **Contrato propio data-first (`CoreAskResult`):** la ruta NO devuelve el
  `ChatResponse` del chat web (acoplado al frontend: `artifacts` con payload de render,
  `chart_spec`, `quick_actions`, `intent_mode`). Un mapper `toCoreAskResult` proyecta a
  un contrato agnóstico de UI: `answer`, `data`, `metric`, `source_views`,
  `validated_sql`, `citations`, `warnings`, `suggested_questions`, `answer_source`,
  `trace_id`, y un **chart hint neutral** (`{type, x, y}`, derivado de `response.chart`).
  Nada del frontend se filtra al MCP.
- **Superficie reservada estable:** sigue siendo `ask` + `schema-catalog`. Las tools
  MCP del producto se sirven como facetas de estas dos: `ask_company_data`→`ask`;
  `describe_business_schema`→`schema-catalog`; `run_readonly_query`→`validated_sql`+
  `data`; `generate_chart_spec`→`chart_hint`; `search_company_knowledge`→`citations`;
  `suggest_executive_questions`→`suggested_questions`.

## Consequences

### Positive

- `mirador-mcp` consume datos gobernados sin DB ni llaves LLM propias.
- El contrato data-first es portable a cualquier agente MCP, no solo al frontend propio.
- Cero cambios al pipeline afinado: el modo stateless es solo otra implementación del
  `ChatRepository` inyectado.
- La auditoría distingue el origen MCP (`client_type='MCP'`).

### Negative

- El contrato MCP y el del chat web divergen (dos shapes a mantener); el mapper
  centraliza la traducción.
- Las llamadas MCP no son rehidratables como hilos (por diseño: son one-shot).

## Implementation Notes

- `createStatelessChatRepository` lanza en los métodos de hilos/mini-chat
  (`listConversations`, `getConversationDetail`, etc.): nunca se alcanzan por `ask`.
- El guard de token (`Bearer CORE_SERVICE_TOKEN`, 503 si no configurado, 401 si
  inválido) cubre todo `/internal/core/*`.
- `CORE_INTERNAL_URL` es el hostname interno (Railway) que `mirador-mcp` usa para
  alcanzar al core; lo consume el MCP, no `mirador-core` (no requiere cambio en
  `env.ts`).

## Related Decisions

- [ADR 0008: Adopt Query Audit Log And Observability](0008-adopt-query-audit-log-and-observability.md)
- [ADR 0010: Adopt Multi-Intent Execution Plan (Combining Metric And Knowledge)](0010-adopt-multi-intent-execution-plan-combining-metric-and-knowledge.md)
- `docs/architecture/proposal.md`
- `docs/checkpoints.md`
