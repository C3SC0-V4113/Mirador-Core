import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/app-error.js';
import { runReadonlyQuery } from '../sql-safety/readonly-query.service.js';
import { createAuditRepository } from '../audit/audit.repositories.js';
import { createEmbeddingProvider } from '../knowledge/embeddings/embedding-provider.js';
import { createKnowledgeRepository } from '../knowledge/knowledge.repositories.js';
import { requireCeo } from '../auth/auth.guard.js';
import { createChatRepository } from './chat.repositories.js';
import { chartEditBodySchema, chatMessageBodySchema } from './chat.schemas.js';
import {
  editArtifactVisualization,
  getConversationDetail,
  handleChatMessage,
  renameConversation,
} from './chat.service.js';
import { createLlmProvider } from './llm/llm-provider.js';

const artifactParamsSchema = z.object({ artifactId: z.uuid() });
const conversationParamsSchema = z.object({ conversationId: z.uuid() });
const renameConversationBodySchema = z.object({ title: z.string().trim().min(1).max(120) });

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
        audit: createAuditRepository(app.prisma),
        knowledge: createKnowledgeRepository(app.prisma),
        embeddings: createEmbeddingProvider(),
      },
      {
        userId: request.currentUser.id,
        message: body.message,
        conversationId: body.conversation_id,
        intentMode: body.intent_mode,
        traceId: request.traceId,
        clientType: 'WEB',
        path: '/api/chat/messages',
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

  app.patch(
    '/api/chat/conversations/:conversationId',
    { preHandler: requireCeo },
    async (request, reply) => {
      if (request.currentUser === undefined) {
        throw new AppError('Authentication required.', 401, 'AUTH_UNAUTHORIZED');
      }

      const params = conversationParamsSchema.parse(request.params);
      const body = renameConversationBodySchema.parse(request.body);
      const response = await renameConversation(
        { repository: createChatRepository(app.prisma) },
        {
          userId: request.currentUser.id,
          conversationId: params.conversationId,
          title: body.title,
        },
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
      const edit =
        'message' in body
          ? ({ kind: 'message', message: body.message } as const)
          : ({
              kind: 'structured',
              chartSpec: {
                type: body.chart_spec.type,
                x: body.chart_spec.x ?? null,
                y: body.chart_spec.y,
              },
            } as const);
      const response = await editArtifactVisualization(
        {
          repository: createChatRepository(app.prisma),
          llm: createLlmProvider(),
        },
        {
          userId: request.currentUser.id,
          artifactId: params.artifactId,
          edit,
        },
      );

      return reply.send(response);
    },
  );

  done();
};
