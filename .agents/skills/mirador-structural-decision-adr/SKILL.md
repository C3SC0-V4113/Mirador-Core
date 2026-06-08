---
name: mirador-structural-decision-adr
description: Create or update Mirador documentation and ADRs when a change affects mirador-core runtime, architecture, deployment topology, service boundaries, internal/public API boundaries, security model, database/runtime credentials, or any structural decision listed in docs/checkpoints.md Phase 1. Use when Codex changes or plans changes to Fastify runtime structure, Prisma/database access mode, Cloudflare/Railway deployment, mirador-mcp separation, Core Internal API boundaries, SQL Safety/RAG/LLM architecture, or cross-service responsibilities.
---

# Mirador Structural Decision ADR

Use this skill to enforce the Phase 1 checkpoint:

> Add an ADR when changing a structural decision of runtime, architecture, or
> service boundaries.

## Workflow

1. Read `docs/checkpoints.md`, `docs/adrs/README.md`, `docs/adrs/template.md`,
   `AGENTS.md`, and the files touched by the change.
2. Decide whether the change is structural using
   `references/structural-decision-guide.md`.
3. If structural, create a new ADR in `docs/adrs/` using the next sequential ADR
   number and the local template.
4. Do not rewrite an accepted ADR to change history. Create a new ADR that records
   the new decision and references the older one.
5. Update affected documentation in the same change:
   - `docs/checkpoints.md` when the roadmap/status changes.
   - `docs/architecture/*.md` when architecture, service topology, boundaries, or
     security responsibilities change.
   - `README.md`, `AGENTS.md`, or `CLAUDE.md` when contributor workflow or service
     identity changes.
6. Run documentation validation through `npm run lint` for docs-only changes. Run
   the full repo checks if code or runtime config also changed.

## ADR Requirements

Every structural ADR must include:

- context and the decision pressure;
- decision drivers;
- options considered when there is a real tradeoff;
- chosen decision;
- consequences and risks;
- implementation notes;
- related decisions or source documents from `walter-excersice`.

## Boundaries

- Do not create ADRs for typo fixes, comments, formatting, dependency patch bumps,
  or local-only documentation that does not alter behavior or responsibility.
- Do not duplicate the `architecture-decision-records` skill; use it for ADR format
  help after this skill decides an ADR is required.
- Do not put MCP runtime behavior inside `mirador-core`; if a decision changes that
  boundary, it requires an ADR.
