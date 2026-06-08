---
name: mirador-core-infrastructure
description: Configure and maintain the mirador-core backend foundation. Use when Codex changes TypeScript, Fastify plugins, Prisma, ESLint, Prettier, Husky, Vitest, environment variables, Docker, deployment, hosting, package scripts, or other infrastructure/tooling for E:\Repositorios\chat-core.
---

# mirador-core Infrastructure

## Overview

Use this skill to keep infrastructure and tooling changes consistent for
`mirador-core`. Keep these tasks separate from auth, LLM orchestration, SQL
safety, RAG and MCP tool implementation unless the user explicitly asks for those
domain features.

## Workflow

1. Read `AGENTS.md`, `package.json`, `tsconfig.json`, `eslint.config.js`,
   `prisma/schema.prisma`, and relevant files under `src/`.
2. If the change is structural, use `mirador-structural-decision-adr` to decide
   the documentation and ADR work, then use `architecture-decision-records` for ADR
   format help.
3. Make the smallest coherent infrastructure change.
4. Keep `src/app.ts` limited to Fastify setup: plugins, routes, error handling and
   cross-cutting HTTP concerns.
5. Keep `src/server.ts` limited to process startup.
6. Validate environment variables with Zod in `src/config/env.ts`.
7. Use `fastify.inject` for HTTP route tests.
8. Run the relevant checks before finishing.

## Boundaries

- Do not create real auth, chat, SQL or RAG domain behavior during pure infrastructure tasks.
- Do not write direct database logic in route handlers.
- Do not add framework abstractions unless they remove real complexity.
- Do not bypass Zod env validation for new runtime config.
- Do not implement MCP inside Fastify; MCP belongs in `mirador-mcp`.

## Expected Checks

Run the checks that match the change. For foundation changes, run all of them:

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

## References

Read `references/project-foundation.md` when changing project structure, scripts,
env conventions, validation workflow or the Fastify foundation.
