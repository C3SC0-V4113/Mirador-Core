import { randomUUID } from 'node:crypto';

import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';

import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/app-error.js';
import type { AuthRepository } from './auth.repositories.js';
import type { AuthenticatedUser, JwtPayload } from './auth.schemas.js';
import { jwtPayloadSchema } from './auth.schemas.js';

const encoder = new TextEncoder();

export type AuthService = {
  login(input: { email: string; password: string }): Promise<{
    token: string;
    user: Pick<AuthenticatedUser, 'id' | 'email' | 'role'>;
    expiresAt: Date;
  }>;
  verifyToken(token: string): Promise<AuthenticatedUser>;
  revokeToken(token: string): Promise<void>;
};

export function buildSessionCookieOptions(
  nodeEnv: string,
  maxAgeSeconds: number,
  sameSite: 'lax' | 'none' = 'lax',
) {
  return {
    httpOnly: true,
    // 'lax' sirve cuando la web comparte sitio registrable con el core (subdominios);
    // 'none' es necesario cuando la web vive en otro dominio (cross-site). El browser
    // exige Secure con SameSite=None, por eso se fuerza secure en ese caso.
    sameSite,
    secure: nodeEnv === 'production' || sameSite === 'none',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export function createAuthService(repository: AuthRepository): AuthService {
  return {
    async login(input) {
      const user = await repository.findUserByEmail(input.email);

      if (user === null) {
        throw new AppError('Invalid email or password.', 401, 'AUTH_INVALID_CREDENTIALS');
      }

      const passwordMatches = await argon2.verify(user.passwordHash, input.password);

      if (!passwordMatches) {
        throw new AppError('Invalid email or password.', 401, 'AUTH_INVALID_CREDENTIALS');
      }

      const expiresAt = new Date(Date.now() + env.SESSION_TTL_SECONDS * 1000);
      const session = await repository.createSession({
        userId: user.id,
        tokenFamilyId: randomUUID(),
        expiresAt,
      });
      const token = await signSessionToken({
        sub: user.id,
        role: 'CEO',
        session_id: session.id,
        token_family_id: session.tokenFamilyId,
        exp: Math.floor(expiresAt.getTime() / 1000),
      });

      return {
        token,
        expiresAt,
        user: {
          id: user.id,
          email: user.email,
          role: 'CEO',
        },
      };
    },

    async verifyToken(token) {
      const payload = await verifySessionToken(token);
      const session = await repository.findActiveSession(payload.session_id, new Date());

      if (session === null) {
        throw new AppError('Authentication required.', 401, 'AUTH_UNAUTHORIZED');
      }

      if (session.user.id !== payload.sub || session.tokenFamilyId !== payload.token_family_id) {
        throw new AppError('Authentication required.', 401, 'AUTH_UNAUTHORIZED');
      }

      return {
        id: session.user.id,
        email: session.user.email,
        role: 'CEO',
        sessionId: session.id,
        tokenFamilyId: session.tokenFamilyId,
      };
    },

    async revokeToken(token) {
      const payload = await verifySessionToken(token);
      await repository.revokeSession(payload.session_id, new Date());
    },
  };
}

async function signSessionToken(payload: JwtPayload) {
  return new SignJWT({
    role: payload.role,
    session_id: payload.session_id,
    token_family_id: payload.token_family_id,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setExpirationTime(payload.exp)
    .sign(encoder.encode(env.JWT_SECRET));
}

async function verifySessionToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(env.JWT_SECRET));

    return jwtPayloadSchema.parse({
      sub: payload.sub,
      role: payload.role,
      session_id: payload.session_id,
      token_family_id: payload.token_family_id,
      exp: payload.exp,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('Authentication required.', 401, 'AUTH_UNAUTHORIZED');
  }
}
