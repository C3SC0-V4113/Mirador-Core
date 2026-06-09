import { randomUUID } from 'node:crypto';

import type { FastifyPluginCallback } from 'fastify';

declare module 'fastify' {
  // Fastify request augmentation requires an interface declaration.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface FastifyRequest {
    traceId: string;
  }
}

export const requestContextPlugin: FastifyPluginCallback = (app, _options, done) => {
  app.decorateRequest('traceId', '');

  app.addHook('onRequest', (request, reply, next) => {
    const requestId = request.headers['x-request-id'];
    const headerTraceId = Array.isArray(requestId) ? requestId[0] : requestId;
    const traceId = headerTraceId ?? randomUUID();

    request.traceId = traceId;
    reply.header('x-trace-id', traceId);
    next();
  });

  done();
};
