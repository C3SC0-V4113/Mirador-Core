import type { FastifyPluginCallback } from 'fastify';

import { requireCeo } from '../auth/auth.guard.js';
import { sendFoundationOnly } from '../../shared/http/foundation-response.js';

export const chatRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.post('/api/chat/messages', { preHandler: requireCeo }, (_request, reply) =>
    sendFoundationOnly(reply, 'chat.messages'),
  );
  app.get('/api/chat/conversations', { preHandler: requireCeo }, (_request, reply) =>
    sendFoundationOnly(reply, 'chat.conversations'),
  );

  done();
};
