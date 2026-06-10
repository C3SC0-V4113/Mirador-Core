# Modelo De Datos MVP

`mirador-core` usa PostgreSQL como base de desarrollo local y Prisma para schema,
migraciones y CRUD de producto. Las consultas analiticas se gobiernan por views
`ceo_*` y por SQL Safety; el runtime no debe consultar tablas internas desde los
caminos de metricas.

## Credenciales

- `DATABASE_URL_MIGRATION`: credencial de migraciones y setup.
- `DATABASE_URL_APP`: credencial de runtime para auth, sesiones y escrituras de
  producto.
- `DATABASE_URL_READONLY`: credencial read-only para consultas analiticas
  validadas.

El `docker-compose.yml` local usa `pgvector/pgvector:pg17`. Las extensiones
(`pgcrypto`, `vector`) y los roles `mirador_app` y `mirador_readonly` se
aprovisionan fuera de las migraciones: `docker/postgres/init/*` en local y un
paso gestionado por entorno en produccion. La migracion solo posee objetos de
schema y los `GRANT` sobre las views. Ver
[ADR 0003](adrs/0003-decouple-role-and-extension-provisioning-from-schema-migration.md).

## Auth

- `users`: usuario MVP unico con `role = CEO`, email y hash Argon2.
- `sessions`: sesiones JWT persistidas con `expires_at`, `revoked_at` y
  `token_family_id`.
- `conversations`: hilo de chat del CEO.

No existe registro publico ni multiusuario operativo en Fases 0-5.

## Chat (Fase 6)

- `chat_messages`: mensajes `USER`/`ASSISTANT` por conversacion, con `intent_mode`
  opcional y `trace_id`.
- `chat_artifacts`: artefactos generados (`artifact_type`, `question`, `period`,
  `source_views`, `validated_sql`, `summary`, `payload`, `chart_spec`,
  `freshness`, `warnings`, `trace_id`).

Estas tablas las escribe el runtime (`mirador_app`); el rol read-only no tiene
acceso. Ver
[ADR 0004](adrs/0004-adopt-chat-orchestrator-with-deterministic-metric-path-and-pluggable-llm.md).

## Tablas Fuente MVP

- `customers`
- `subscriptions`
- `invoices`
- `sales_opportunities`
- `projects`
- `time_entries`
- `support_tickets`
- `expenses`

El seed usa `external_id` para hacer `upsert` idempotente de datos sinteticos de
18 meses en USD. Incluye anomalias intencionales en cobros, delivery, soporte y
gasto para habilitar preguntas ejecutivas.

## Views Gobernadas

- `ceo_revenue_summary`
- `ceo_customer_health`
- `ceo_sales_pipeline`
- `ceo_project_margin`
- `ceo_delivery_risk`
- `ceo_support_health`
- `ceo_financial_runway`
- `ceo_customer_revenue`: ingresos facturados por cliente y por mes (habilita la
  metrica `customer_revenue`).

Estas views son la superficie permitida para catalogo semantico y fallback SQL.
El rol `mirador_readonly` recibe `SELECT` sobre estas views, no sobre tablas
internas.

## Catalogo Y SQL Safety

`config/metric-catalog.json` define metricas, dimensiones, filtros, formato,
grano y chart default. El catalogo publico remueve `source_view`; el contexto
interno conserva solo views y columnas allowlisted.

SQL Safety valida AST antes de ejecutar SQL:

- una sola sentencia;
- solo `SELECT`;
- fuentes `ceo_*` allowlisted;
- columnas y funciones allowlisted;
- sin `SELECT *`;
- `LIMIT` default y maximo configurables;
- timeout por consulta.
