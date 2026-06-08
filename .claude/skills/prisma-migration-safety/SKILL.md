---
name: prisma-migration-safety
description: Handle Prisma schema and migration work safely for ceo-chat-core. Use when Codex changes prisma/schema.prisma, runs prisma migrate dev, edits files under prisma/migrations, or deals with drift, reset prompts, enum changes, nullability changes, renames, drops, backfills, pg_dump, or pg_restore.
---

# Prisma Migration Safety

## Overview

Use this skill to decide whether a Prisma change is safe, needs staged data
migration, or requires explicit user approval before any destructive action. Treat
local data as important by default.

## Required Workflow

1. Read `AGENTS.md`, `prisma.config.ts`, `prisma/schema.prisma`, `package.json`, and
   any affected migration files before proposing execution.
2. Classify the change:
   - `additive`: new tables, nullable columns, indexes, optional relations.
   - `incompatible`: `NOT NULL`, unique constraints over existing data, enum edits,
     renames, relation rewrites.
   - `destructive`: drops, resets, truncation, replacing data without recovery.
3. Assume existing data matters unless the user clearly says otherwise.
4. Before any reset or destructive step, ask the user explicitly whether current
   data is disposable, what must be preserved, and whether a backup exists.
5. Prefer additive migrations, backfills in migration SQL, and expand/contract over
   one-shot destructive changes.
6. Use `.local/backups/` as the default local backup directory and keep dumps out of Git.

## Reset Rules

- Never accept a Prisma reset prompt silently.
- Never reset without explicit user confirmation.
- If the user has not answered preservation questions, do not reset.
- If reset is acceptable because data is disposable, state the consequence clearly
  before running it.

## Verification

After schema work, run the repo workflow that applies:

```powershell
npm run db:migrate
npm run db:generate
npm run typecheck
npm run lint
npm run test
npm run build
```

Only run seed steps when schema changes invalidate seeded data.
