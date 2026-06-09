import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';

import { authRoutes } from './modules/auth/auth.routes.js';
import { chatRoutes } from './modules/chat/chat.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { internalCoreRoutes } from './modules/internal-core/internal-core.routes.js';
import { schemaCatalogRoutes } from './modules/schema-catalog/schema-catalog.routes.js';
import { registerPrisma, registerReadonlyPrisma } from './shared/db/prisma.js';
import { registerErrorHandler } from './shared/http/error-handler.js';
import { registerRequestContext } from './shared/http/request-context.js';
import { createLoggerOptions } from './shared/logging/logger.js';

export type BuildAppOptions = {
  prisma?: PrismaClient;
  prismaReadonly?: PrismaClient;
};

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: createLoggerOptions(),
  });

  registerErrorHandler(app);

  await app.register(helmet);
  await app.register(cors, {
    origin: false,
  });
  await app.register(cookie);
  registerPrisma(app, options.prisma);
  registerReadonlyPrisma(app, options.prismaReadonly);
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });
  registerRequestContext(app);
  await app.register(authRoutes);
  await app.register(chatRoutes);
  await app.register(schemaCatalogRoutes);
  await app.register(internalCoreRoutes);
  await app.register(healthRoutes);

  return app;
}
