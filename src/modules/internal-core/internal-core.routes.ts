import type { FastifyPluginCallback, FastifyRequest } from 'fastify';

import { env } from '../../config/env.js';
import { createAuditRepository } from '../audit/audit.repositories.js';
import { createStatelessChatRepository } from '../chat/chat.repositories.js';
import { handleChatMessage } from '../chat/chat.service.js';
import { createLlmProvider } from '../chat/llm/llm-provider.js';
import { createEmbeddingProvider } from '../knowledge/embeddings/embedding-provider.js';
import { createKnowledgeRepository } from '../knowledge/knowledge.repositories.js';
import { runReadonlyQuery } from '../sql-safety/readonly-query.service.js';
import { buildBusinessSchemaContext } from '../schema-catalog/metric-catalog.js';
import { toCoreAskResult } from './internal-core.mapper.js';
import { internalAskBodySchema } from './internal-core.schemas.js';

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

  // Expone el MISMO pipeline gobernado que el chat web (capa semantica, SQL Safety,
  // read-only, auditoria) a servicios internos como mirador-mcp. Stateless: usa el
  // repositorio sin persistencia, audita con clientType=MCP y devuelve un contrato
  // data-first (CoreAskResult), no el ChatResponse acoplado al frontend.
  app.post('/internal/core/ask', async (request, reply) => {
    const body = internalAskBodySchema.parse(request.body);

    const response = await handleChatMessage(
      {
        repository: createStatelessChatRepository(),
        llm: createLlmProvider(),
        runQuery: (sql) => runReadonlyQuery(app.prismaReadonly, sql),
        fallbackEnabled: env.FALLBACK_SQL_ENABLED,
        logger: app.log,
        audit: createAuditRepository(app.prisma),
        knowledge: createKnowledgeRepository(app.prisma),
        embeddings: createEmbeddingProvider(),
      },
      {
        userId: null,
        message: body.question,
        intentMode: body.intent_mode,
        traceId: request.traceId,
        clientType: 'MCP',
        path: '/internal/core/ask',
      },
    );

    return reply.send(toCoreAskResult(response));
  });

  app.get('/internal/core/schema-catalog', (_request, reply) =>
    reply.send(buildBusinessSchemaContext()),
  );

  done();
};
