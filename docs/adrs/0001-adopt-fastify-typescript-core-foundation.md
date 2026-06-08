# ADR 0001: Adopt Fastify TypeScript Core Foundation

- Date: 2026-06-08
- Status: Accepted

## Context

`mirador-core` is the backend core for the Mirador CEO analytics system. The
architecture was first described in `walter-excersice`, but this repository must
become the executable service foundation.

The project needs a reliable backend baseline before implementing authentication,
LLM orchestration, semantic metrics, SQL safety, RAG, audit logs or internal MCP
integration.

## Decision Drivers

- Match the working backend structure used by `Identity-Service`.
- Keep the first implementation executable and testable.
- Preserve a clean route/module structure for future domain work.
- Prepare for PostgreSQL and Prisma without requiring DB access in foundation tests.
- Keep MCP as a separate service that calls the Core Internal API.

## Decision

Use this foundation:

- `Fastify` for HTTP.
- `TypeScript` strict mode.
- `Zod` for environment validation.
- `PostgreSQL` as target database.
- `Prisma` for schema, client generation and migrations.
- `Vitest` for route tests with `fastify.inject`.
- `ESLint`, `Prettier`, `markdownlint`, `yamllint`, `Husky` and `lint-staged`.

Reserve the initial public and internal route surface, but return explicit
`foundation_only` responses until the domain behavior is implemented.

## Consequences

### Positive

- The repo starts as a runnable backend, not only a document set.
- Future modules can follow a predictable Fastify pattern.
- Tests can validate service wiring before database and LLM work exists.
- The service boundary with `mirador-mcp` is explicit from the first commit.

### Negative

- More setup than a minimal proof of concept.
- Some dependencies are present before their domain modules use them.
- Placeholder routes require discipline so they do not get mistaken for product behavior.

## Implementation Notes

- `src/app.ts` builds and configures Fastify.
- `src/server.ts` is the process entrypoint.
- `GET /health` is the first concrete route.
- `/internal/core/*` requires `CORE_SERVICE_TOKEN` before any response is exposed.
- Prisma runtime connection is deferred until the first domain module needs DB access.

## Related Decisions

- `docs/architecture/proposal.md`
- `docs/architecture/semantic-layer-and-model-strategy.md`
- `docs/architecture/rag-knowledge-layer.md`
