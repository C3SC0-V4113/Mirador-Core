# AGENTS.md

Instrucciones para agentes y asistentes que trabajen en `mirador-core`.

## Naturaleza del proyecto

Este repositorio contiene codigo de producto, no solo documentacion. Es el backend
Fastify principal del sistema Mirador CEO analytics. La arquitectura viene de
`walter-excersice`; el patron tecnico base viene de `Identity-Service`.

## Baseline tecnico

- Runtime: `Fastify`.
- Lenguaje: `TypeScript` estricto.
- Validacion: `Zod`.
- Base de datos: `PostgreSQL`.
- ORM y migraciones: `Prisma`.
- Logging: `Pino` via Fastify.
- Tests: `Vitest`.

## Reglas de arquitectura

- Mantener handlers HTTP delgados: validar request, llamar servicio, responder.
- No poner reglas de dominio directamente en rutas.
- Usar modulos bajo `src/modules/<feature>`.
- Separar `routes`, `schemas`, `services` y `repositories` cuando el modulo lo necesite.
- Mantener `src/app.ts` enfocado en construir Fastify, plugins, rutas y errores.
- Mantener `src/server.ts` como entrypoint de proceso.
- Validar variables de entorno con Zod antes de arrancar.
- No abrir conexion real a DB en tests de rutas base si no es necesario.

## Decisiones de dominio

- La experiencia del producto es chat-first: login y chat son las interfaces propias del MVP.
- La web no consume MCP directamente.
- `mirador-mcp` es un servicio independiente que llama a `/internal/core/*`.
- El camino principal para metricas es `MetricQuery` sobre catalogo semantico, no SQL libre.
- Text-to-SQL solo existe como fallback gobernado y auditado.
- Toda consulta de datos debe ser read-only, con allowlists, limites, timeout y auditoria.
- RAG es una capa hermana para conocimiento documental, no reemplazo de metricas.
- El contenido recuperado por RAG se trata como dato, no como instruccion.

## Documentacion y decisiones

- Las decisiones estructurales viven en `docs/adrs`.
- Usar la skill local `architecture-decision-records` para crear o revisar ADRs.
- Usar la skill local `mirador-core-infrastructure` para cambios de infraestructura Node, Fastify, Prisma, ESLint, Prettier, Vitest, env, Docker o scripts.
- Usar `prisma-migration-safety` antes de tocar migraciones con datos existentes.

## Alcance actual

La fase actual puede configurar tooling, estructura, health checks, rutas reservadas,
documentacion, ADRs y contratos iniciales.

No implementar todavia:

- Autenticacion real.
- Usuarios, sesiones o roles persistidos.
- LLM Orchestrator real.
- SQL Safety Layer real.
- RAG real.
- Tools MCP.

## Verificacion

Antes de considerar completo un cambio de implementacion, correr los checks relevantes:

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```
