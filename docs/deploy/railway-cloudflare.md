# Runbook de Deploy — mirador-core en Railway + Cloudflare

Guía operativa para desplegar `mirador-core` en producción. Cubre solo este servicio;
`mirador-web`, `mirador-mcp`, `mirador-ingestion` y R2 son otros repos. Ver
[ADR-0012](../adrs/0012-adopt-railway-cloudflare-deployment-topology.md) para el porqué.

## Topología

```text
Internet (web)        → [Web API Gateway · Cloudflare]  → Railway → mirador-core  /api/*
Internet (cliente MCP)→ [MCP API Gateway · Cloudflare]  → Railway → mirador-mcp
                                                                       │ (red privada Railway)
                                                                       ▼
                                                                  mirador-core  /internal/*
mirador-core → [AI Gateway · Cloudflare] → OpenAI (LLM + embeddings)
```

- `/api/*` entra por el **Web API Gateway** y exige el header de origen secreto.
- `/internal/*` viaja por la **red privada de Railway** (no Cloudflare); frontera = red
  privada + `CORE_SERVICE_TOKEN`.
- `/health` lo consume el healthcheck interno de Railway (sin Cloudflare).

## Variables de entorno de producción

Obligatorias (el `superRefine` falla el arranque si faltan o son los defaults de dev):

| Variable                   | Descripción                                                             |
| -------------------------- | ----------------------------------------------------------------------- |
| `NODE_ENV`                 | `production`                                                            |
| `JWT_SECRET`               | Secreto fuerte (≥32), no el default de dev                              |
| `CEO_PASSWORD_HASH`        | Hash argon2 del password real del CEO                                   |
| `CORE_SERVICE_TOKEN`       | Token service-to-service para `/internal/*` (≥12)                       |
| `CLOUDFLARE_ORIGIN_SECRET` | Secreto compartido que Cloudflare inyecta como `x-mirador-origin` (≥16) |
| `DATABASE_URL_MIGRATION`   | Rol con privilegios para `prisma migrate deploy`                        |
| `DATABASE_URL_APP`         | Rol RW de runtime                                                       |
| `DATABASE_URL_READONLY`    | Rol RO de runtime (consultas analíticas)                                |

Según proveedor LLM:

| Variable                              | Descripción                                           |
| ------------------------------------- | ----------------------------------------------------- |
| `LLM_PROVIDER` / `EMBEDDING_PROVIDER` | `openai` en producción                                |
| `OPENAI_API_KEY`                      | Requerida cuando cualquiera es `openai`               |
| `OPENAI_BASE_URL`                     | Endpoint del AI Gateway de Cloudflare (ver más abajo) |
| `EMBEDDING_MODEL`                     | `text-embedding-3-small` (al cambiarlo, reingestar)   |

Frontend / sesión (según topología de dominio):

| Variable                  | Descripción                                                            |
| ------------------------- | ---------------------------------------------------------------------- |
| `WEB_ORIGIN`              | Origen del frontend para habilitar CORS con credenciales               |
| `SESSION_COOKIE_SAMESITE` | `lax` (web y core comparten dominio registrable) o `none` (cross-site) |
| `PORT` / `HOST`           | Railway inyecta `PORT`; `HOST` queda `0.0.0.0`                         |

## Pasos en Railway

1. **Provisionar PostgreSQL** (pgvector). Crear roles `mirador_app` y `mirador_readonly`
   y habilitar las extensiones `vector`/`pgcrypto` **antes** de la primera migración
   (provisioning separado de la migración — ADR-0003).
2. **Crear el servicio** apuntando al repo. Railway usa `railway.json` (Nixpacks):
   build = `prisma generate && tsc`; start = `npx prisma migrate deploy && node dist/server.js`.
3. **Cargar las variables** de la tabla de arriba.
4. **Primer deploy:** el `startCommand` aplica las migraciones (vía `prisma.config.ts` →
   `DATABASE_URL_MIGRATION`) y arranca. Healthcheck en `/health`.
5. **Seed inicial** (una vez): `npm run db:seed`.
6. **Ingesta de conocimiento** (una vez / al actualizar docs): `npm run knowledge:ingest`.
7. **Private networking:** ubicar `mirador-mcp` en el mismo proyecto/región y apuntar su
   `CORE_INTERNAL_URL` al hostname interno de `mirador-core`.

## Checklist en Cloudflare

**Web API Gateway (frente a `/api/*` de mirador-core):**

- [ ] DNS del dominio del core en Cloudflare, proxied (nube naranja), CNAME al dominio de Railway.
- [ ] WAF y Rate Limiting Rules activos.
- [ ] API Shield: validación de schema (OpenAPI) y JWT si aplica.
- [ ] Transform Rule que inyecta el header `x-mirador-origin: <CLOUDFLARE_ORIGIN_SECRET>`
      en las requests hacia el origen.
- [ ] Mantener `/internal/*` **fuera** de este gateway (no se publica).

**MCP API Gateway (frente a la entrada externa de mirador-mcp):** protege el tráfico MCP
no confiable de internet (valida `MCP_API_KEY`). No interviene en `mcp → /internal`, que
va por red privada.

**AI Gateway (salida a OpenAI):**

- [ ] Crear el gateway; copiar su endpoint a `OPENAI_BASE_URL`
      (`https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openai`).
- [ ] Caché: **ON para embeddings** (deterministas), **OFF para completions**.
- [ ] Revisar analytics de costo/uso.

## Topología de dominio (CORS + cookie)

- **Subdominios del mismo sitio** (p.ej. `app.mirador.com` + `api.mirador.com`):
  `SESSION_COOKIE_SAMESITE=lax`, `WEB_ORIGIN=https://app.mirador.com`.
- **Dominios distintos** (web cross-site): `SESSION_COOKIE_SAMESITE=none` (fuerza
  `Secure`), `WEB_ORIGIN` = el origen de la web.
- **Mismo hostname con path routing** (web en `/`, core en `/api`): same-origin, sin CORS
  ni ajustes de cookie.

## Verificación post-deploy

- `GET /health` → `200 { status: "ok" }`.
- `GET /api/...` **sin** el header de origen → `403 ORIGIN_FORBIDDEN`.
- `GET /api/...` a través de Cloudflare (con el header inyectado) → pasa.
- Login web → cookie de sesión con los flags correctos (`Secure`, `SameSite` esperado).
- Una pregunta de chat real → respuesta gobernada + fila en `query_audit_log`.
