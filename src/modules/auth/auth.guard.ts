import type { FastifyReply, FastifyRequest } from 'fastify';

import { env } from '../../config/env.js';
import { createAuthRepository } from './auth.repositories.js';
import type { AuthenticatedUser } from './auth.schemas.js';
import { createAuthService } from './auth.service.js';

declare module 'fastify' {
  // Fastify request augmentation requires an interface declaration.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface FastifyRequest {
    currentUser?: AuthenticatedUser;
  }
}

export async function requireCeo(request: FastifyRequest, reply: FastifyReply) {
  const token = getSessionToken(request);

  if (token === undefined) {
    await reply.status(401).send({
      error: {
        code: 'AUTH_UNAUTHORIZED',
        message: 'Authentication required.',
      },
    });
    return;
  }

  const service = createAuthService(createAuthRepository(request.server.prisma));
  request.currentUser = await service.verifyToken(token);
}

export function getSessionToken(request: FastifyRequest) {
  return request.cookies[env.SESSION_COOKIE_NAME];
}
