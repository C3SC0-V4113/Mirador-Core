# Structural Decision Guide

Create or update an ADR when a change affects any item below.

## Runtime Structure

- Fastify composition, plugin topology, app/server split, or module boundaries.
- Environment variable contract, runtime credential mode, or secret ownership.
- Prisma connection strategy, read-only runtime policy, migration credential policy.

## Architecture

- Chat-first product flow or route ownership.
- Semantic layer, `MetricQuery`, SQL compiler, fallback SQL, or schema context design.
- SQL Safety Layer guarantees: AST validation, allowlists, limits, timeout, read-only role.
- RAG architecture: pgvector, knowledge retrieval, embeddings, `access_scope`, citations.
- LLM provider strategy, model routing, prompt caching, planner/synthesis split.

## Service Boundaries

- Public API versus internal API boundary.
- `/internal/core/*` contract, authorization, or exposure model.
- `mirador-mcp` as standalone adapter versus logic inside `mirador-core`.
- Cloudflare gateway responsibilities versus service-level authorization.
- Railway private network, `CORE_INTERNAL_URL`, or `CORE_SERVICE_TOKEN` responsibilities.

## Documentation To Update

- `docs/adrs/`: always for structural decisions.
- `docs/checkpoints.md`: roadmap or phase status changes.
- `docs/architecture/proposal.md`: system topology, flow, security, deployment.
- `docs/api/routes.md`: public/internal route contract changes.
- `docs/database-model.md`: persistent model or read/write credential changes.
- `AGENTS.md` and `CLAUDE.md`: agent workflow or repository rule changes.

## No ADR Needed

- Typo-only documentation changes.
- Formatting or lint-only changes.
- Adding tests for existing behavior.
- Refactoring internals without changing public/internal contracts or service ownership.
- Dependency patch/minor updates that do not change runtime architecture or policy.
