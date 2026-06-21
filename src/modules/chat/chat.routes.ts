import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/app-error.js';
import { runReadonlyQuery } from '../sql-safety/readonly-query.service.js';
import { requireCeo } from '../auth/auth.guard.js';
import { createChatRepository } from './chat.repositories.js';
import { chartEditBodySchema, chatMessageBodySchema } from './chat.schemas.js';
import {
  editArtifactVisualization,
  getConversationDetail,
  handleChatMessage,
} from './chat.service.js';
import { createLlmProvider } from './llm/llm-provider.js';

const artifactParamsSchema = z.object({ artifactId: z.uuid() });
const conversationParamsSchema = z.object({ conversationId: z.uuid() });

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
        fallbackEnabled: env.FALLBACK_SQL_ENABLED,
        logger: app.log,
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

  app.get(
    '/api/chat/conversations/:conversationId',
    { preHandler: requireCeo },
    async (request, reply) => {
      if (request.currentUser === undefined) {
        throw new AppError('Authentication required.', 401, 'AUTH_UNAUTHORIZED');
      }

      const params = conversationParamsSchema.parse(request.params);
      const response = await getConversationDetail(
        { repository: createChatRepository(app.prisma) },
        { userId: request.currentUser.id, conversationId: params.conversationId },
      );

      return reply.send(response);
    },
  );

  // Mini-chat de gráficas: edita la visualización de un artefacto ya generado.
  app.post(
    '/api/chat/artifacts/:artifactId/visualization',
    { preHandler: requireCeo },
    async (request, reply) => {
      if (request.currentUser === undefined) {
        throw new AppError('Authentication required.', 401, 'AUTH_UNAUTHORIZED');
      }

      const params = artifactParamsSchema.parse(request.params);
      const body = chartEditBodySchema.parse(request.body);
      const response = await editArtifactVisualization(
        {
          repository: createChatRepository(app.prisma),
          llm: createLlmProvider(),
        },
        {
          userId: request.currentUser.id,
          artifactId: params.artifactId,
          message: body.message,
        },
      );

      return reply.send(response);
    },
  );

  done();
};
