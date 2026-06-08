import type { FastifyPluginCallback } from 'fastify';

import { sendFoundationOnly } from '../../shared/http/foundation-response.js';

export const chatRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.post('/api/chat/messages', (_request, reply) => sendFoundationOnly(reply, 'chat.messages'));
  app.get('/api/chat/conversations', (_request, reply) => sendFoundationOnly(reply, 'chat.conversations'));

  done();
};
