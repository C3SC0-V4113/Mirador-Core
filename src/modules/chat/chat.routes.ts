import type { FastifyPluginCallback } from 'fastify';

import { AppError } from '../../shared/errors/app-error.js';
import { runReadonlyQuery } from '../sql-safety/readonly-query.service.js';
import { requireCeo } from '../auth/auth.guard.js';
import { createChatRepository } from './chat.repositories.js';
import { chatMessageBodySchema } from './chat.schemas.js';
import { handleChatMessage } from './chat.service.js';
import { createLlmProvider } from './llm/llm-provider.js';

export const chatRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.post('/api/chat/messages', { preHandler: requireCeo }, async (request, reply) => {
    if (request.currentUser === undefined) {
      throw new AppError('Authentication required.', 401, 'AUTH_UNAUTHORIZED');
    }

    const body = chatMessageBodySchema.parse(request.body);
    const response = await handleChatMessage(
      {
        repository: createChatRepository(app.prisma),
        llm: createLlmProvider(),
        runQuery: (sql) => runReadonlyQuery(app.prismaReadonly, sql),
      },
      {
        userId: request.currentUser.id,
        message: body.message,
        conversationId: body.conversation_id,
        intentMode: body.intent_mode,
        traceId: request.traceId,
      },
    );

    return reply.send(response);
  });

  app.get('/api/chat/conversations', { preHandler: requireCeo }, async (request, reply) => {
    if (request.currentUser === undefined) {
      throw new AppError('Authentication required.', 401, 'AUTH_UNAUTHORIZED');
    }

    const repository = createChatRepository(app.prisma);
    const conversations = await repository.listConversations(request.currentUser.id);

    return reply.send({ conversations });
  });

  done();
};
