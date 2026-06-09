import type { FastifyPluginCallback, FastifyRequest } from 'fastify';

import { env } from '../../config/env.js';
import { sendFoundationOnly } from '../../shared/http/foundation-response.js';
import { buildBusinessSchemaContext } from '../schema-catalog/metric-catalog.js';

function isAuthorizedInternalRequest(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  const expectedToken = env.CORE_SERVICE_TOKEN;

  return expectedToken !== undefined && authorization === `Bearer ${expectedToken}`;
}

export const internalCoreRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.addHook('preHandler', (request, reply, next) => {
    if (!request.url.startsWith('/internal/core/')) {
      next();
      return;
    }

    if (env.CORE_SERVICE_TOKEN === undefined) {
      void reply.status(503).send({
        error: {
          code: 'INTERNAL_CORE_NOT_CONFIGURED',
          message: 'CORE_SERVICE_TOKEN must be configured before internal core routes can be used.',
        },
      });
      return;
    }

    if (!isAuthorizedInternalRequest(request)) {
      void reply.status(401).send({
        error: {
          code: 'INTERNAL_CORE_UNAUTHORIZED',
          message: 'Internal core routes require a valid bearer token.',
        },
      });
      return;
    }

    next();
  });

  app.post('/internal/core/ask', (_request, reply) =>
    sendFoundationOnly(reply, 'internal-core.ask'),
  );
  app.get('/internal/core/schema-catalog', (_request, reply) =>
    reply.send(buildBusinessSchemaContext()),
  );

  done();
};
