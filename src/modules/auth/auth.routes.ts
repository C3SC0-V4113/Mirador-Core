import type { FastifyPluginCallback } from 'fastify';

import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/app-error.js';
import { getSessionToken, requireCeo } from './auth.guard.js';
import { createAuthRepository } from './auth.repositories.js';
import { loginBodySchema } from './auth.schemas.js';
import { buildSessionCookieOptions, createAuthService } from './auth.service.js';

export const authRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.post('/api/auth/login', async (request, reply) => {
    const body = loginBodySchema.parse(request.body);
    const authService = createAuthService(createAuthRepository(app.prisma));
    const result = await authService.login(body);

    return reply
      .setCookie(
        env.SESSION_COOKIE_NAME,
        result.token,
        buildSessionCookieOptions(env.NODE_ENV, env.SESSION_TTL_SECONDS),
      )
      .send({
        user: result.user,
        expires_at: result.expiresAt.toISOString(),
      });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = getSessionToken(request);

    if (token !== undefined) {
      const authService = createAuthService(createAuthRepository(app.prisma));
      await authService.revokeToken(token);
    }

    return reply.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' }).send({
      status: 'ok',
    });
  });

  app.get('/api/auth/session', { preHandler: requireCeo }, (request, reply) => {
    if (request.currentUser === undefined) {
      throw new AppError('Authentication required.', 401, 'AUTH_UNAUTHORIZED');
    }

    return reply.send({
      user: {
        id: request.currentUser.id,
        email: request.currentUser.email,
        role: request.currentUser.role,
      },
    });
  });

  done();
};
