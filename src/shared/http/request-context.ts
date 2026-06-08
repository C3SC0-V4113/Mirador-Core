import { randomUUID } from 'node:crypto';

import type { FastifyPluginCallback } from 'fastify';

export const requestContextPlugin: FastifyPluginCallback = (app, _options, done) => {
  app.addHook('onRequest', (request, reply, next) => {
    const requestId = request.headers['x-request-id'];
    const traceId = Array.isArray(requestId) ? requestId[0] : requestId;

    reply.header('x-trace-id', traceId ?? randomUUID());
    next();
  });

  done();
};
