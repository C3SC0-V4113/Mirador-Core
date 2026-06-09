import type { FastifyPluginCallback } from 'fastify';

import { requireCeo } from '../auth/auth.guard.js';
import { buildMetricCatalogContext } from './metric-catalog.js';

export const schemaCatalogRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get('/api/schema/catalog', { preHandler: requireCeo }, (_request, reply) =>
    reply.send(buildMetricCatalogContext()),
  );

  done();
};
