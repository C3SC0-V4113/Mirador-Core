import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

import { env } from '../../config/env.js';

type FakeUser = {
  id: string;
  email: string;
  role: 'CEO';
  passwordHash: string;
};

type FakeSession = {
  id: string;
  userId: string;
  tokenFamilyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export async function createFakePrisma() {
  const user: FakeUser = {
    id: randomUUID(),
    email: env.CEO_EMAIL,
    role: 'CEO',
    passwordHash: await argon2.hash('mirador-dev-password'),
  };
  const sessions = new Map<string, FakeSession>();

  return {
    user: {
      findUnique: ({ where }: { where: { email: string } }) =>
        Promise.resolve(where.email === user.email ? user : null),
    },
    session: {
      create: ({ data }: { data: { userId: string; tokenFamilyId: string; expiresAt: Date } }) => {
        const session: FakeSession = {
          id: randomUUID(),
          userId: data.userId,
          tokenFamilyId: data.tokenFamilyId,
          expiresAt: data.expiresAt,
          revokedAt: null,
        };
        sessions.set(session.id, session);

        return Promise.resolve(session);
      },
      findFirst: ({
        where,
      }: {
        where: { id: string; revokedAt: null; expiresAt: { gt: Date } };
      }) => {
        const session = sessions.get(where.id);

        if (session === undefined) {
          return Promise.resolve(null);
        }

        if (session.revokedAt !== null || session.expiresAt <= where.expiresAt.gt) {
          return Promise.resolve(null);
        }

        return Promise.resolve({
          ...session,
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
          },
        });
      },
      updateMany: ({
        where,
        data,
      }: {
        where: { id: string; revokedAt: null };
        data: { revokedAt: Date };
      }) => {
        const session = sessions.get(where.id);

        if (session?.revokedAt === null) {
          sessions.set(session.id, {
            ...session,
            revokedAt: data.revokedAt,
          });
        }

        return Promise.resolve();
      },
    },
  } as unknown as PrismaClient;
}
