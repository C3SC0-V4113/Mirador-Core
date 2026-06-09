# ADR 0003: Decouple Role And Extension Provisioning From The Schema Migration

- Date: 2026-06-08
- Status: Accepted

## Context

ADR 0002 introduced the initial migration `20260608160000_initial_mvp_foundation`
and deliberately made it create the `mirador_app` and `mirador_readonly` roles to
keep local setup idempotent, since Docker init scripts do not rerun for existing
volumes.

That migration also hardcodes development passwords
(`CREATE ROLE mirador_app LOGIN PASSWORD 'mirador_app_dev'`) and creates the
`pgcrypto` and `vector` extensions. Because Prisma runs the same migration files
in every environment, `prisma migrate deploy` against the production database
would either:

- create runtime roles with weak, source-controlled development passwords, or
- fail outright, because managed PostgreSQL (Railway) generally does not grant a
  migration role permission to `CREATE ROLE` or `CREATE EXTENSION`.

Both outcomes are unacceptable. Role identity and credentials are an environment
concern and must not be owned by schema migrations.

## Decision Drivers

- Never ship runtime database credentials in source control.
- Keep migrations portable across local and managed PostgreSQL.
- Preserve the separated-credential model from ADR 0002 (migration / app / readonly).
- Fail loudly when an environment is misprovisioned instead of silently creating
  weak roles.

## Decision

Split ownership of database setup by concern:

- The Prisma migration owns only schema objects: enums, tables, indexes, views,
  and the `GRANT` statements that bind those views to the analytics role. `GRANT`
  stays in the migration because it is object-scoped authorization that requires
  the objects to exist and ships no secrets.
- Role identity and credentials (`CREATE ROLE ... PASSWORD`) and extension
  creation (`pgcrypto`, `vector`) are provisioned per environment, outside
  migrations:
  - Local: `docker/postgres/init/000-extensions.sql` and
    `docker/postgres/init/001-dev-roles.sql`, executed at container init before
    migrations run.
  - Production: a managed/out-of-band step (Railway roles and enabled
    extensions). If the roles or extensions are missing, the migration's `GRANT`
    and `gen_random_uuid()` usage fail with a clear error.

This refines, but does not rewrite, the idempotency choice recorded in ADR 0002.

## Consequences

### Positive

- No development passwords are embedded in migrations.
- `prisma migrate deploy` no longer attempts privileged `CREATE ROLE` /
  `CREATE EXTENSION` on managed PostgreSQL.
- Schema and environment provisioning have distinct, auditable ownership.

### Negative

- A fresh local setup now depends on the Docker init scripts having created the
  roles and extensions; an existing volume created before this change may need
  `docker compose down -v` (or manual role creation) before migrating.
- Editing the already-applied initial migration requires `prisma migrate reset`
  on local development databases, which is acceptable because the data is
  disposable and reseeded.

## Implementation Notes

- Removed the `CREATE EXTENSION` lines and the `DO $$ ... CREATE ROLE ... $$`
  block from `migration.sql`; left a comment pointing to this ADR.
- Added `docker/postgres/init/000-extensions.sql` for `pgcrypto` and `vector`.
- Kept `docker/postgres/init/001-dev-roles.sql` as the local role source.
- Production must provision `mirador_app` and `mirador_readonly` with strong
  passwords and enable `pgcrypto`/`vector` before `prisma migrate deploy`.

## Related Decisions

- [ADR 0002: Adopt Local Postgres, CEO Auth, Semantic Catalog And SQL Safety](0002-adopt-local-postgres-auth-semantic-catalog-and-sql-safety.md)
- `docs/checkpoints.md`
- `docs/database-model.md`
