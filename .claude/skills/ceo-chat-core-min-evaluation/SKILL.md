---
name: ceo-chat-core-min-evaluation
description: Run the minimum local quality checks required before declaring implementation work complete in ceo-chat-core. Use when wrapping up changes, validating readiness, or deciding which checks apply for code, Prisma, env, Docker, script, infrastructure, or documentation changes.
---

# ceo-chat-core Minimum Evaluation

Use this skill before declaring implementation work complete in `ceo-chat-core`.

## Required Checks

Run all of these commands when the change touches application code, shared code,
Prisma, environment validation, Docker or infrastructure files, package scripts, or
repo tooling:

1. `npm run typecheck`
2. `npm run lint`
3. `npm run test`
4. `npm run build`

## Conditional Scope

- Run the full check set for changes in `src/`, `prisma/`, `package.json`,
  `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`,
  `.env.example`, `docker-compose.yml`, `.husky/` or shared project tooling.
- If the change is docs-only, run the relevant content linting through `npm run lint`
  and report that runtime behavior remains unverified for the changed scope.
- If a task is blocked and a required check cannot run, report the blocker instead
  of claiming completion.

## Failure Reporting

If a required check fails or cannot be executed, report:

- exact command
- exact error or failure output
- remaining unverified scope

## Completion Policy

Only report completion when every required check for the touched scope passes, or
when blockers and unverified scope are clearly documented.
