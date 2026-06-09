# ADR 0002: Adopt Local Postgres, CEO Auth, Semantic Catalog And SQL Safety

- Date: 2026-06-08
- Status: Accepted

## Context

`mirador-core` moved beyond the executable foundation into the first product
backend capabilities: CEO web authentication, local development data, semantic
metrics, and SQL governance.

The roadmap requires Docker Desktop PostgreSQL for development, separated
database credentials, a single-CEO MVP auth model, governed `ceo_*` views, a
versioned metric catalog, and SQL Safety before any generated or compiled query
can execute.

## Decision Drivers

- Keep the web experience login and chat-first while leaving chat orchestration
  for a later phase.
- Avoid direct access to raw source tables from runtime analytics paths.
- Let local development run from Docker Desktop without waiting for Railway.
- Preserve Prisma for schema and CRUD while treating SQL validation as an
  independent security layer.
- Keep tests independent from real database connections where possible.

## Decision

Adopt this implementation baseline for Fases 0-5:

- PostgreSQL `pgvector` runs locally through `docker-compose.yml`.
- Prisma Migrate uses `DATABASE_URL_MIGRATION`.
- Application CRUD uses `DATABASE_URL_APP`.
- Analytics execution uses `DATABASE_URL_READONLY`.
- The MVP user model supports only `role = CEO`.
- Web sessions use JWT in an `HttpOnly`, `SameSite=Lax` cookie named
  `mirador_session`.
- The semantic catalog lives in a versioned JSON file and exposes compact
  catalog contexts without DDL or internal tables.
- SQL Safety uses an AST parser, allows only one `SELECT`, rejects raw internal
  tables, blocks unapproved functions, disallows `SELECT *`, and enforces limits.

## Consequences

### Positive

- Development can run locally with realistic Postgres views and seed data.
- Auth and schema endpoints now have product behavior instead of placeholders.
- The analytics surface has defense in depth before LLM fallback work begins.
- Runtime read-only policy is represented in env contracts and database grants.

### Negative

- The initial migration is larger because it introduces auth, source tables,
  views and grants together.
- The SQL Safety Layer is intentionally restrictive and will need explicit
  expansion as query needs grow.
- Docker init scripts do not rerun for existing volumes; migrations also create
  roles to keep setup idempotent.

## Implementation Notes

- Seed data is deterministic and uses `upsert` by synthetic `external_id`.
- `POST /api/chat/messages` and `GET /api/chat/conversations` remain
  `foundation_only`, but now require CEO authentication.
- `POST /internal/core/ask` remains reserved for later phases.
- `GET /internal/core/schema-catalog` returns the allowlisted business schema
  context when authorized with `CORE_SERVICE_TOKEN`.

## Related Decisions

- [ADR 0001: Adopt Fastify TypeScript Core Foundation](0001-adopt-fastify-typescript-core-foundation.md)
- `docs/checkpoints.md`
- `docs/architecture/proposal.md`
- `docs/architecture/semantic-layer-and-model-strategy.md`
