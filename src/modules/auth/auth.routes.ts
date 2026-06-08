import type { FastifyPluginCallback } from 'fastify';

import { sendFoundationOnly } from '../../shared/http/foundation-response.js';

export const authRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.post('/api/auth/login', (_request, reply) => sendFoundationOnly(reply, 'auth.login'));
  app.post('/api/auth/logout', (_request, reply) => sendFoundationOnly(reply, 'auth.logout'));
  app.get('/api/auth/session', (_request, reply) => sendFoundationOnly(reply, 'auth.session'));

  done();
};
