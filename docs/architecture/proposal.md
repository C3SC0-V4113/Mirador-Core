# Arquitectura Sintetizada

## Objetivo

`mirador-core` es el backend principal para que un CEO consulte datos de negocio
en lenguaje natural desde una experiencia web chat-first y desde clientes MCP
externos por medio de un servicio adapter separado.

El servicio debe responder preguntas ejecutivas con narrativa, tablas, KPIs,
graficas, advertencias y `trace_id`, usando datos read-only y fuentes
documentales citadas cuando aplique.

## Componentes

- **Web app (`mirador-web`)**: login y chat. No consume MCP directamente.
- **Backend core (`mirador-core`)**: Fastify, auth web, LLM Orchestrator, capa
  semantica, fallback SQL gobernado, RAG retrieval, auditoria y Core Internal API.
- **Servicio MCP (`mirador-mcp`)**: adapter remoto MCP. Valida `MCP_API_KEY` y
  llama a `/internal/core/*`.
- **Ingestion (`mirador-ingestion`)**: procesamiento asincrono de documentos para RAG.
- **PostgreSQL + pgvector**: datos ejecutivos, auditoria y chunks documentales.
- **Cloudflare R2**: almacenamiento de documentos fuente para RAG.

Para desarrollo local, PostgreSQL corre en Docker Desktop con la imagen
`pgvector/pgvector:pg17`. Railway sigue siendo el target de despliegue MVP, pero no
es requisito para ejecutar las Fases 0-5.

## Rutas del core

Publicas:

- `/api/auth/*`
- `/api/chat/*`
- `/api/schema/catalog`

Internas:

- `/internal/core/ask`
- `/internal/core/schema-catalog`

Las rutas internas no deben publicarse como API de browser. Su consumidor esperado es
`mirador-mcp` o servicios internos autenticados.

## Flujo chat-first

1. La web envia una pregunta a `POST /api/chat/messages`.
2. El backend valida sesion y rol.
3. El planner produce un `execution_plan`: `metric_query`, `knowledge_lookup` o
   `direct_answer`.
4. Las subtareas se ejecutan en paralelo cuando sea posible.
5. La respuesta se sintetiza en un unico payload con artefactos, citas, warnings y
   `trace_id`.

## Seguridad base

- Login obligatorio para web.
- Token service-to-service para `/internal/core/*`.
- Usuario PostgreSQL read-only en runtime.
- SQL Safety Layer antes de cualquier consulta generada o compilada.
- Allowlist de views, columnas, funciones y limites.
- Auditoria de prompt, path, `MetricQuery`, SQL validado, documentos recuperados y
  `trace_id`.

La implementacion inicial separa `DATABASE_URL_MIGRATION`, `DATABASE_URL_APP` y
`DATABASE_URL_READONLY` para mantener la politica read-only verificable desde el
contrato de entorno.
