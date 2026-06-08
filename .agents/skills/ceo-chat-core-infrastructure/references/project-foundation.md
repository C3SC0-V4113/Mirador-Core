# ceo-chat-core Project Foundation

## Structure

```text
src/
  app.ts
  server.ts
  config/
    env.ts
  modules/
    <module>/
      <module>.routes.ts
      <module>.test.ts
  shared/
    errors/
    http/
    logging/
prisma/
  schema.prisma
docs/
  adrs/
```

## Scripts

Keep these scripts available:

- `dev`
- `build`
- `start`
- `typecheck`
- `lint`
- `format`
- `test`
- `test:coverage`
- `db:generate`
- `db:migrate`
- `db:seed`

## Environment

Document new variables in `.env.example` and validate them in `src/config/env.ts`.

Baseline variables:

- `NODE_ENV`
- `PORT`
- `HOST`
- `DATABASE_URL`
- `LOG_LEVEL`
- `CORE_SERVICE_TOKEN`

## Fastify Conventions

- Register plugins in `src/app.ts`.
- Register module routes from `src/app.ts` or a route aggregator once the app grows.
- Use `fastify.inject` for route tests.
- Keep route handlers thin and move business rules into module services or use cases.

## Verification Checklist

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```
