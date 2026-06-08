# mirador-core

Backend core para el sistema **Mirador CEO analytics**.

Este repositorio es la base ejecutable del servicio `mirador-core`, descrito en
`walter-excersice` como el backend Fastify principal del producto. La primera fase
deja dependencias, estructura, rutas reservadas, documentacion, ADRs y herramientas
agenticas. No implementa todavia autenticacion real, LLM Orchestrator, SQL Safety
Layer, RAG, metric catalog productivo ni acceso a datos.

## Rol del servicio

`mirador-core` concentra la logica que deben compartir la web y el servicio MCP:

- Autenticacion web del CEO.
- Orquestacion chat-first.
- Capa semantica y fallback Text-to-SQL gobernado.
- Validacion SQL read-only.
- Recuperacion documental RAG.
- Auditoria y `trace_id`.
- Core Internal API para `mirador-mcp`.

El endpoint MCP remoto no vive aqui. `mirador-mcp` sera un servicio separado que
expone `POST /mcp` y llama a `/internal/core/*` con token service-to-service.

## Estado actual

Fase de fundacion ejecutable.

Incluido:

- Fastify + TypeScript.
- Validacion de entorno con Zod.
- Prisma configurado con PostgreSQL.
- Vitest con pruebas de rutas base.
- ESLint, Prettier, markdownlint y yamllint.
- Rutas HTTP reservadas con respuesta `foundation_only`.
- Documentacion sintetizada desde `walter-excersice`.

Fuera de alcance por ahora:

- Login real y sesiones JWT.
- Ejecucion real de preguntas de chat.
- Catalogo de metricas productivo.
- Generacion SQL, AST parser y SQL Safety Layer.
- RAG sobre `pgvector`.
- Servicio MCP.

## Rutas base

Publicas:

- `GET /health`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `POST /api/chat/messages`
- `GET /api/chat/conversations`
- `GET /api/schema/catalog`

Internas:

- `POST /internal/core/ask`
- `GET /internal/core/schema-catalog`

Las rutas internas requieren `CORE_SERVICE_TOKEN`; si no esta configurado,
responden `503 INTERNAL_CORE_NOT_CONFIGURED`.

## Local setup

1. Copiar `.env.example` a `.env`.
2. Instalar dependencias:

   ```powershell
   npm install
   ```

3. Levantar PostgreSQL local cuando se empiece a usar Prisma en runtime:

   ```powershell
   docker compose up -d
   ```

4. Generar Prisma Client:

   ```powershell
   npm run db:generate
   ```

5. Ejecutar el servicio:

   ```powershell
   npm run dev
   ```

## Checks

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

## Documentacion

- [Rutas](docs/api/routes.md)
- [Arquitectura](docs/architecture/proposal.md)
- [Capa semantica](docs/architecture/semantic-layer-and-model-strategy.md)
- [RAG](docs/architecture/rag-knowledge-layer.md)
- [Modelo de datos](docs/database-model.md)
- [Checkpoints](docs/checkpoints.md)
- [ADRs](docs/adrs/README.md)
- [Diagramas](docs/diagrams/README.md)
