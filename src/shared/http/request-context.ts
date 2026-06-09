import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  // Fastify request augmentation requires an interface declaration.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface FastifyRequest {
    traceId: string;
  }
}

// Se registra directamente sobre la instancia raiz (no via app.register) para que
// la decoracion y el hook apliquen a TODAS las rutas. Dentro de un plugin
// encapsulado, el hook no correria para rutas hermanas y `request.traceId`
// quedaria indefinido.
export function registerRequestContext(app: FastifyInstance) {
  app.decorateRequest('traceId', '');

  app.addHook('onRequest', (request, reply, next) => {
    const requestId = request.headers['x-request-id'];
    const headerTraceId = Array.isArray(requestId) ? requestId[0] : requestId;
    const traceId = headerTraceId ?? randomUUID();

    request.traceId = traceId;
    reply.header('x-trace-id', traceId);
    next();
  });
}
