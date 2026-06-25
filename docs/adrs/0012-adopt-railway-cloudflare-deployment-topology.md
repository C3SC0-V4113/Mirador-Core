# ADR 0012: Adopt Railway + Cloudflare Deployment Topology For The MVP

- Date: 2026-06-22
- Status: Accepted

## Context

El MVP de `mirador-core` necesita salir a producción. El target es **Railway**
(Fastify + Prisma + PostgreSQL/pgvector) detrás de **Cloudflare** como gateway de
entrada, y con el **AI Gateway** de Cloudflare delante de las llamadas a OpenAI. Antes
de este corte el repo corría solo local: faltaba el empaquetado de deploy, la
validación de que el tráfico público venga por el borde (anti-bypass), `trustProxy`,
CORS para una web cross-origin y el cableado del AI Gateway. Este ADR fija la topología
y las decisiones de borde que toca `mirador-core`; el despliegue de `mirador-web`,
`mirador-mcp`, `mirador-ingestion` y R2 son otros servicios/repos.

## Decision Drivers

- Exponer solo lo necesario: las rutas públicas por el borde de Cloudflare; lo interno,
  privado.
- Reusar el pipeline gobernado sin cambios; el deploy es borde + config, no lógica.
- Encajar con las limitaciones reales de Railway (no expone control de TLS de origen).
- Mantener la frontera de la Core Internal API en la red privada (ADR-0011, Fase 9).

## Decision

- **Entrada por Cloudflare (proxy + WAF + API Shield).** El tráfico público a `/api/*`
  pasa por Cloudflare (DNS proxied) antes de llegar a Railway. Cloudflare aporta TLS,
  WAF, rate limiting y validación de schema/JWT (API Shield).
- **Anti-bypass por header secreto, no mTLS.** Cloudflare inyecta `x-mirador-origin`
  con `CLOUDFLARE_ORIGIN_SECRET` (Transform Rule); un `onRequest` guard
  (`src/shared/http/origin-guard.ts`) rechaza con `403` las requests a `/api/*` que no
  lo traigan. Se eligió header secreto sobre mTLS porque Railway no expone el control de
  terminación TLS del origen que requiere Authenticated Origin Pull; el checkpoint ya
  ubicaba mTLS fuera del MVP. El guard **exime** `/health` (healthcheck interno de
  Railway) y `/internal/*` (red privada + `CORE_SERVICE_TOKEN`). En desarrollo (secret
  sin setear) es no-op. `CLOUDFLARE_ORIGIN_SECRET` es requerido en producción
  (`superRefine`).
- **AI Gateway para OpenAI.** `OPENAI_BASE_URL` (opcional) apunta el cliente OpenAI
  (LLM + embeddings) al AI Gateway de Cloudflare para caché, observabilidad y control de
  costos. Caché recomendada: **ON para embeddings** (deterministas), **OFF para
  completions** (la respuesta depende de datos/contexto cambiantes). Es config de
  Cloudflare; el código solo pasa el `baseURL`.
- **`mcp → /internal` por red privada de Railway**, no por Cloudflare (ADR-0011): la
  Core Internal API no se expone a internet. El MCP API Gateway protege solo la entrada
  externa a `mirador-mcp`.
- **`trustProxy` activo** en Fastify: detrás del proxy, el rate-limit y los logs leen la
  IP real del cliente (`CF-Connecting-IP`/`X-Forwarded-For`).
- **CORS y cookie parametrizados.** `WEB_ORIGIN` habilita CORS con credenciales para el
  frontend; `SESSION_COOKIE_SAMESITE` permite `none` (cross-site) o `lax` (subdominios
  del mismo sitio). `none` fuerza `Secure`.
- **Empaquetado: `railway.json` + Nixpacks.** Healthcheck `/health`, restart
  `ON_FAILURE`, y `startCommand` que corre `prisma migrate deploy` antes de
  `node dist/server.js`. Las migraciones resuelven la URL por `prisma.config.ts`
  (`DATABASE_URL_MIGRATION`); el runtime sigue usando `DATABASE_URL_APP`/`_READONLY`.
  Roles y extensión `vector`/`pgcrypto` se provisionan aparte (ADR-0003).

## Consequences

### Positive

- `/api/*` protegido en el borde y a prueba de bypass; `/internal/*` nunca sale a
  internet.
- AI Gateway da caché de embeddings (ahorro) y visibilidad del gasto en OpenAI.
- Deploy reproducible con un `railway.json`; migraciones aplicadas en cada arranque.

### Negative

- El header secreto protege el origen pero no autentica criptográficamente como mTLS
  (aceptable para el MVP; mTLS queda como evolución futura).
- CORS/cookie cross-site requieren elegir bien el dominio final; se documenta en el
  runbook.

## Implementation Notes

- El guard se prueba con una función pura (`isForbiddenApiOrigin`); el wiring depende de
  `CLOUDFLARE_ORIGIN_SECRET` y se valida en el arranque de producción.
- `npx prisma migrate deploy` requiere que `prisma` esté disponible en runtime (Nixpacks
  conserva `node_modules`); si se podan devDependencies, mover `prisma` a dependencies o
  correr las migraciones en un paso de release.

## Related Decisions

- [ADR 0003: Decouple Role And Extension Provisioning From The Schema Migration](0003-decouple-role-and-extension-provisioning-from-schema-migration.md)
- [ADR 0011: Expose The Governed Core Pipeline Via An Internal Service-To-Service API](0011-expose-governed-core-pipeline-via-internal-service-to-service-api.md)
- `docs/deploy/railway-cloudflare.md`
- `docs/checkpoints.md`
