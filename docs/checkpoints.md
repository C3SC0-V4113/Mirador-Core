# Checkpoints De Producto Para `mirador-core`

## Objetivo Del Proyecto

`mirador-core` es el backend Fastify del producto Mirador: un chatbot ejecutivo
para un CEO de una empresa desarrolladora de software. El core debe concentrar el
pipeline compartido por la web y por `mirador-mcp`: autenticacion web, orquestacion
LLM, capa semantica de metricas, fallback SQL gobernado, SQL Safety Layer,
recuperacion documental RAG, auditoria y Core Internal API.

El MVP no es dashboard-first ni report-first. Las interfaces propias son login y
chatbot; los reportes, tablas, KPIs, graficas y planes de accion se generan como
artefactos dentro de la conversacion.

## Fuentes De Requerimientos

Este roadmap se deriva de `E:\Repositorios\walter-excersice`:

- `docs/architecture/proposal.md`: arquitectura Mirador, servicios `mirador-*`,
  rutas objetivo, seguridad, flujo chat-first y flujo MCP.
- `docs/discovery/open-questions.md`: decisiones cerradas MVP, metricas oficiales,
  datos, experiencia y preguntas futuras.
- `docs/discovery/data-assumptions.md`: tablas fuente, views `ceo_*`, credenciales,
  seed y modelo de artefactos/auditoria.
- `docs/discovery/use-cases.md`: casos de revenue, churn, pipeline, delivery,
  margen, soporte, finanzas y preguntas sugeridas.
- `docs/discovery/user-challenges.md`: necesidad de guiar al CEO con sugerencias,
  aclaraciones y evidencia.
- `docs/adr/0005-adopt-chatbot-first-guided-analytics-experience.md`: decision
  chat-first.
- `docs/adr/0006-adopt-headless-semantic-metrics-layer-and-model-strategy.md`:
  capa semantica, `MetricQuery`, schema contexts y modelos.
- `docs/adr/0007-adopt-api-gateways-and-standalone-mcp-service.md`: gateways y
  `mirador-mcp` independiente.
- `docs/adr/0008-adopt-rag-knowledge-layer-and-multi-intent-orchestration.md`:
  RAG, pgvector y orquestacion multi-intencion.

## Estado Actual

- [x] Scaffold Fastify + TypeScript + Prisma creado.
- [x] Ruta `GET /health` implementada.
- [x] Rutas reservadas para auth, chat, schema catalog e internal core.
- [x] Validacion de entorno base con Zod.
- [x] Prisma schema baseline.
- [x] Vitest route tests.
- [x] README, AGENTS, CLAUDE, ADRs y diagramas base.
- [x] Skills externas y locales instaladas en `.agents/skills`.
- [x] `skills-lock.json` generado.
- [x] Husky pre-commit con `npx lint-staged`.
- [x] Nombre interno actualizado a `mirador-core`.
- [x] Dominio real de auth CEO, datos MVP, catalogo semantico y SQL Safety inicial.
- [ ] Dominio real de chat, LLM, RAG y MCP interno.

## Fase 1: Fundacion Backend

Fuente: `Identity-Service` como patron tecnico y `walter-excersice/docs/architecture/proposal.md`.

- [x] Mantener `src/app.ts` como composicion de Fastify, plugins, rutas y errores.
- [x] Mantener `src/server.ts` como entrypoint de proceso.
- [x] Mantener `src/config/env.ts` como validacion unica de variables runtime.
- [x] Mantener `src/modules/*` con rutas delgadas y logica fuera de handlers.
- [x] Mantener checks obligatorios: `typecheck`, `lint`, `test`, `build`.
- [x] Crear skill local `mirador-structural-decision-adr` para guiar cambios de
      documentacion y ADRs ante decisiones estructurales.
- [x] Agregar un ADR cuando se cambie una decision estructural de runtime,
      arquitectura o limites de servicio.

## Fase 2: Auth CEO Y Sesion Web

Fuentes: `open-questions.md`, `data-assumptions.md`, ADR-0004 y ADR-0005.

- [x] Modelar usuario unico `CEO` para MVP, sin registro publico ni multiusuario.
- [x] Crear seed/setup para `CEO_EMAIL` y `CEO_PASSWORD_HASH` sin documentar
      credenciales reales en texto plano.
- [x] Implementar login web en `POST /api/auth/login`.
- [x] Implementar logout en `POST /api/auth/logout`.
- [x] Implementar `GET /api/auth/session` como endpoint liviano para validar sesion.
- [x] Emitir JWT con `sub`, `role = CEO`, expiracion y, si aplica, `session_id`.
- [x] Validar rol `CEO` en backend antes de exponer chat, schema o consultas.
- [x] Persistir sesiones con `expires_at`, `revoked_at`, `token_family_id` y
      trazabilidad minima.
- [x] Documentar variables `CEO_EMAIL`, `CEO_PASSWORD_HASH` y `JWT_SECRET` en
      `.env.example`.

## Fase 3: Modelo De Datos MVP Y Seed

Fuentes: `data-assumptions.md`, `open-questions.md` y `use-cases.md`.

- [x] Separar credenciales de DB: `DATABASE_URL_MIGRATION` para migraciones/setup y
      `DATABASE_URL_READONLY` para runtime read-only.
- [x] Configurar PostgreSQL Docker Desktop para desarrollo MVP y Prisma como ORM.
- [x] Habilitar dataset ficticio de 12 a 18 meses en USD.
- [x] Incluir anomalies intencionales para alertas, explicacion de cambios y
      preguntas contextuales.
- [x] Modelar tablas fuente candidatas: `customers`, `subscriptions`, `invoices`,
      `sales_opportunities`, `projects`, `time_entries`, `support_tickets`,
      `expenses`.
- [x] Crear views gobernadas `ceo_revenue_summary`, `ceo_customer_health`,
      `ceo_sales_pipeline`, `ceo_project_margin`, `ceo_delivery_risk`,
      `ceo_support_health`, `ceo_financial_runway`.
- [x] Cubrir casos de revenue, churn, pipeline, delivery, margen, soporte y finanzas
      desde el seed.
- [x] Evitar que el runtime consulte tablas internas no autorizadas cuando existan
      views `ceo_*`.

## Fase 4: Catalogo Semantico Y Schema Contexts

Fuentes: ADR-0006, `semantic-layer-and-model-strategy.md` y `open-questions.md`.

- [x] Crear catalogo de metricas versionado en YAML o JSON.
- [x] Cubrir metricas oficiales MVP: MRR, ARR, crecimiento MRR, expansion revenue,
      churn rate, clientes en riesgo, pipeline por etapa, forecast de cierre,
      proyectos en riesgo, margen por proyecto, tickets criticos, SLA, burn rate,
      runway y costos por area.
- [x] Definir por metrica: `name`, `label`, `description`, `synonyms`, `grain`,
      `source_view`, `measure`, `dimensions`, `filters_allowed`, `time_column`,
      `format`, `default_chart`.
- [x] Implementar contrato `MetricQuery` con validacion Zod.
- [x] Validar que `metric`, `dimensions`, `filters`, `time_range`, `compare_to` y
      `limit` pertenezcan al catalogo permitido por rol.
- [x] Implementar `MetricCatalogContext` compacto y cacheable para el camino
      semantico.
- [x] Implementar `BusinessSchemaContext` allowlisted para fallback SQL.
- [x] Exponer `GET /api/schema/catalog` autenticado sin DDL crudo ni objetos
      internos no autorizados.

## Fase 5: SQL Safety Layer

Fuentes: `proposal.md`, ADR-0005, ADR-0006 y `data-assumptions.md`.

- [x] Implementar parser AST para validar SQL, no solo regex.
- [x] Permitir solo `SELECT`.
- [x] Bloquear DDL, DML, multiples statements y funciones no autorizadas.
- [x] Aplicar allowlist de views, columnas, relaciones y funciones.
- [x] Forzar `LIMIT`, max rows y timeout.
- [x] Ejecutar runtime con rol PostgreSQL read-only.
- [x] Validar tanto SQL determinista de la capa semantica como SQL candidato de
      fallback.
- [x] Rechazar tablas internas no autorizadas y schema crudo fuera del contrato.
- [x] Emitir errores o aclaraciones cuando una pregunta no pueda resolverse de forma
      segura.

## Fase 6: Chat Orchestrator Y Artefactos

Fuentes: ADR-0005, `proposal.md`, `data-assumptions.md`, `use-cases.md` y
`user-challenges.md`.

- [ ] Implementar `POST /api/chat/messages`.
- [ ] Implementar `GET /api/chat/conversations`.
- [ ] Persistir `conversations` y `chat_messages`.
- [ ] Soportar `intent_mode`: `responder`, `analizar`, `reporte_visual`, `plan`.
- [ ] Combinar requisitos del modo con requisitos explicitos del prompt; el modo no
      debe descartar lo pedido por el usuario.
- [ ] Guiar el chat con preguntas sugeridas, acciones rapidas y aclaraciones.
- [ ] Incluir preguntas sugeridas base: cambio del ultimo periodo, proyectos que
      requieren atencion, clientes en riesgo, variacion de MRR y tickets criticos.
- [ ] Devolver narrativa ejecutiva, `data`, `artifacts`, `chart`, `warnings`,
      `suggested_questions`, metadata y `trace_id`.
- [ ] Persistir `chat_artifacts` con `artifact_type`, pregunta, periodo,
      `source_views`, `validated_sql`, `summary`, `payload`, `chart_spec`,
      `freshness`, `warnings` y `trace_id`.
- [ ] Soportar artefactos `text`, `table`, `kpi`, `chart`, `report` y
      `action_plan`.
- [ ] Implementar mini chat contextual para editar `chart_spec` de graficas ya
      generadas.
- [ ] Evitar nueva query cuando la edicion solo cambie visualizacion; derivar al chat
      principal cuando cambien datos, periodo, metrica o fuente.

## Fase 7: RAG Y Orquestacion Multi-Intencion

Fuentes: ADR-0008 y `rag-knowledge-layer.md`.

- [ ] Habilitar extension `pgvector` en PostgreSQL.
- [ ] Modelar `documents` con `title`, `source_uri`, `doc_type`, `version`,
      `content_hash`, `access_scope`, `indexed_at` y `status`.
- [ ] Modelar `document_chunks` con `document_id`, `chunk_index`, `content`,
      `embedding`, `token_count`, `locator` y `content_hash`.
- [ ] Implementar `KnowledgeBaseContext` compacto y cacheable.
- [ ] Implementar Knowledge Retrieval interno en `mirador-core`: embedding de query,
      busqueda vectorial top-k, filtro por `access_scope`/rol y metadata de cita.
- [ ] Configurar `EMBEDDING_PROVIDER` y `EMBEDDING_MODEL`.
- [ ] Usar `text-embedding-3-small` como default de embeddings y documentar
      reindexacion al cambiar modelo.
- [ ] Mantener rerank opcional y apagado por defecto.
- [ ] Exigir citas a documento y localizador para narrativa documental.
- [ ] Responder que no se encontro evidencia cuando los chunks recuperados no
      fundamenten la respuesta.
- [ ] Tratar contenido recuperado como dato, no como instruccion, para mitigar
      prompt-injection.
- [ ] Implementar `execution_plan` tipado con `metric_query`, `knowledge_lookup` y
      `direct_answer`.
- [ ] Validar limites y tipos del `execution_plan`.
- [ ] Despachar subtareas en paralelo cuando el prompt combine metrica y
      conocimiento.
- [ ] Sintetizar una sola respuesta con artefactos de metricas y narrativa documental
      con citas.

## Fase 8: Core Internal API Para `mirador-mcp`

Fuentes: ADR-0007, `proposal.md` y `mcp-first-access.md`.

- [ ] Mantener `POST /mcp` fuera de Fastify; pertenece a `mirador-mcp`.
- [ ] Implementar `POST /internal/core/ask` para exponer el pipeline core a
      servicios internos.
- [ ] Implementar `GET /internal/core/schema-catalog` para catalogo interno
      autenticado.
- [ ] Validar `CORE_SERVICE_TOKEN` en cada request interna.
- [ ] Documentar `CORE_INTERNAL_URL` como hostname interno de Railway consumido por
      `mirador-mcp`.
- [ ] Rechazar `/internal/*` cuando llegue por interfaz publica o sin token valido.
- [ ] Asegurar que `mirador-mcp` no necesite `DATABASE_URL_*` ni llaves LLM.
- [ ] Mantener una sola capa semantica, una sola SQL Safety Layer, un solo read-only y
      una sola auditoria en `mirador-core`.
- [ ] Diseñar respuestas internas compatibles con tools MCP como
      `describe_business_schema`, `ask_company_data`, `run_readonly_query`,
      `suggest_executive_questions`, `generate_chart_spec` y
      `search_company_knowledge`.

## Fase 9: Auditoria, Observabilidad Y Seguridad

Fuentes: `proposal.md`, `data-assumptions.md`, ADR-0006, ADR-0007 y ADR-0008.

- [ ] Generar `trace_id` por respuesta y propagarlo en logs, auditoria y payload.
- [ ] Implementar `query_audit_log` con `user_id`, `client_type`, `path`,
      `question`, `metric_query`, `fallback_reason`, `missing_metric_or_dimension`,
      `generated_sql`, `validated_sql`, hashes de SQL, `validation_status` y timestamps.
- [ ] Extender auditoria con `execution_plan` y `retrieved_doc_ids` para RAG.
- [ ] Emitir log `warn` `analytics.fallback_sql_triggered` cuando se use fallback SQL.
- [ ] Sanitizar o hashear SQL/preguntas cuando contengan valores sensibles.
- [ ] Auditar web y MCP con el mismo modelo.
- [ ] Exponer `freshness`, `warnings`, `source_views` y `trace_id` en artefactos de
      chat.
- [ ] Aplicar defensa en profundidad para Core Internal API: red privada Railway como
      frontera primaria y `CORE_SERVICE_TOKEN` como segunda capa.
- [ ] Separar secretos web, MCP, DB y proveedor LLM.

## Fase 10: Deployment MVP

Fuentes: `proposal.md`, `data-assumptions.md` y ADR-0007.

- [ ] Desplegar `mirador-core` en Railway con Fastify + Prisma.
- [ ] Usar Railway PostgreSQL como base MVP.
- [ ] Desplegar `mirador-web` en Cloudflare Workers con OpenNext/Cloudflare.
- [ ] Desplegar `mirador-mcp` como servicio independiente en Railway, misma region que
      el backend.
- [ ] Configurar Web API Gateway en Cloudflare frente a `mirador-core`.
- [ ] Configurar MCP API Gateway en Cloudflare frente a `mirador-mcp`.
- [ ] Aplicar rate limiting, throttling, cuotas, WAF/IP rules, limite de tamano y
      routing por gateway.
- [ ] Mantener `/internal/core/*` fuera del Web API Gateway.
- [ ] Configurar R2 para archivos fuente de RAG.
- [ ] Preparar `mirador-ingestion` como servicio Railway con cola interna en Postgres
      o Redis, sin Cloudflare Queues.

## Fuera Del MVP / Futuro

Fuentes: `open-questions.md`, ADR-0005, ADR-0007 y ADR-0008.

- [ ] Roles CFO, COO o lideres de area.
- [ ] Registro publico o multiusuario operativo.
- [ ] Datos reales desde sistemas transaccionales, warehouse o archivos externos.
- [ ] Multi-moneda y reglas contables reales.
- [ ] Dashboard persistente, widgets SSR o historico formal de reportes.
- [ ] Reportes programados por correo, Slack u otros canales.
- [ ] Tiempo real o near-real-time para soporte/proyectos.
- [ ] mTLS para Core Internal API.
- [ ] Migrar la capa semantica a dbt Semantic Layer si escalan roles y fuentes.
- [ ] Migrar vector store a Cloudflare Vectorize u otro servicio si pgvector queda
      corto.
- [ ] OCR avanzado para documentos escaneados.
- [ ] Edicion de documentos desde el chat.
