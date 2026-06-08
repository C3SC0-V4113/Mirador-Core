import type { FastifyPluginCallback } from 'fastify';

export const healthRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get('/health', () => ({
    status: 'ok',
    service: 'ceo-chat-core',
  }));

  done();
};
