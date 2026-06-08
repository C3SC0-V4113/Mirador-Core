import type { FastifyPluginCallback } from 'fastify';

import { sendFoundationOnly } from '../../shared/http/foundation-response.js';

export const schemaCatalogRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get('/api/schema/catalog', (_request, reply) => sendFoundationOnly(reply, 'schema.catalog'));

  done();
};
