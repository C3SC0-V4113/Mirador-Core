import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';

import { env } from './config/env.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { chatRoutes } from './modules/chat/chat.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { internalCoreRoutes } from './modules/internal-core/internal-core.routes.js';
import { schemaCatalogRoutes } from './modules/schema-catalog/schema-catalog.routes.js';
import { registerPrisma, registerReadonlyPrisma } from './shared/db/prisma.js';
import { registerErrorHandler } from './shared/http/error-handler.js';
import { registerOriginGuard } from './shared/http/origin-guard.js';
import { registerRequestContext } from './shared/http/request-context.js';
import { createLoggerOptions } from './shared/logging/logger.js';

export type BuildAppOptions = {
  prisma?: PrismaClient;
  prismaReadonly?: PrismaClient;
};

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: createLoggerOptions(),
    // Detras de Cloudflare/Railway: confiar en X-Forwarded-* para que el rate-limit
    // y los logs vean la IP real del cliente (CF-Connecting-IP), no la del proxy.
    trustProxy: true,
  });

  registerErrorHandler(app);

  await app.register(helmet);
  await app.register(cors, {
    // Cross-origin solo para el frontend declarado (mirador-web). Sin WEB_ORIGIN,
    // CORS queda cerrado (solo same-origin). credentials habilita el envio de la
    // cookie de sesion desde la web.
    origin: env.WEB_ORIGIN ?? false,
    credentials: env.WEB_ORIGIN !== undefined,
  });
  await app.register(cookie);
  registerPrisma(app, options.prisma);
  registerReadonlyPrisma(app, options.prismaReadonly);
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });
  registerRequestContext(app);
  registerOriginGuard(app);
  await app.register(authRoutes);
  await app.register(chatRoutes);
  await app.register(schemaCatalogRoutes);
  await app.register(internalCoreRoutes);
  await app.register(healthRoutes);

  return app;
}
