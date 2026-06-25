import type { FastifyInstance } from 'fastify';

import { env } from '../../config/env.js';

const ORIGIN_HEADER = 'x-mirador-origin';

// Logica pura del guard (testeable sin levantar Fastify): rechaza solo las rutas
// publicas /api/* cuyo header de origen no coincide con el secreto. /health y
// /internal/* nunca se rechazan (tienen sus propias fronteras).
export function isForbiddenApiOrigin(
  url: string,
  headerValue: string | string[] | undefined,
  secret: string,
): boolean {
  if (!url.startsWith('/api/')) {
    return false;
  }

  const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return provided !== secret;
}

// Cierra el bypass directo al origen: detras de Cloudflare, las rutas publicas
// (/api/*) solo deben recibir trafico que paso por el borde. Cloudflare inyecta el
// header `x-mirador-origin` con el secreto compartido (Transform Rule); si una
// request a /api/* no lo trae o no coincide, alguien le esta pegando directo al
// origen de Railway salteando el WAF -> 403.
//
// Exenciones:
// - `/health`: lo consume el healthcheck interno de Railway (red interna, sin pasar
//   por Cloudflare), asi que nunca traeria el header.
// - `/internal/*`: viaja por la red privada de Railway (mirador-mcp), no por
//   Cloudflare; su frontera es la red privada + CORE_SERVICE_TOKEN.
//
// En desarrollo (CLOUDFLARE_ORIGIN_SECRET sin setear) el guard es no-op.
export function registerOriginGuard(app: FastifyInstance) {
  const secret = env.CLOUDFLARE_ORIGIN_SECRET;

  if (secret === undefined) {
    return;
  }

  app.addHook('onRequest', (request, reply, next) => {
    if (isForbiddenApiOrigin(request.url, request.headers[ORIGIN_HEADER], secret)) {
      void reply.status(403).send({
        error: {
          code: 'ORIGIN_FORBIDDEN',
          message: 'Requests to public routes must come through the Cloudflare edge.',
        },
      });
      return;
    }

    next();
  });
}
