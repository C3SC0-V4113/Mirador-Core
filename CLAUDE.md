# CLAUDE.md

Guia rapida para Claude Code en este repositorio. La fuente principal es
[AGENTS.md](AGENTS.md); este archivo solo resume el contexto operativo.

## Reglas clave

- Escribir documentacion en espanol tecnico y pragmatico.
- Tratar este repo como backend ejecutable, no como solo propuesta.
- No implementar SQL libre como camino principal.
- Mantener MCP fuera de Fastify: `ceo-chat-mcp` es un servicio separado.
- Las rutas `/internal/core/*` son service-to-service y requieren `CORE_SERVICE_TOKEN`.
- No exponer secretos, schema crudo ni credenciales LLM/DB.

## Estado

Scaffold ejecutable de `ceo-chat-core`.

Incluye rutas reservadas, tests base y documentacion. Las respuestas
`foundation_only` significan que la superficie fue reservada, pero el dominio no
esta implementado aun.

## Mapa

```text
src/app.ts                 Construccion de Fastify.
src/server.ts              Entrypoint de proceso.
src/config/env.ts          Variables de entorno validadas con Zod.
src/modules/               Modulos HTTP.
src/shared/                Infra compartida.
docs/adrs/                 Decisiones de arquitectura.
docs/architecture/         Arquitectura sintetizada del proyecto.
docs/diagrams/             Mermaid fuente para diagramas.
.agents/skills/            Skills locales y externas del repo.
.claude/skills             Enlace a .agents/skills.
```

## Skills

Las skills instaladas se gestionan con `skills-lock.json` y viven en
`.agents/skills/`. `.claude/skills` debe apuntar a `.agents/skills/` para que
Claude Code las descubra.
