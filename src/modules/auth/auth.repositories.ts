import type { PrismaClient, Session, User } from '@prisma/client';

export type SessionWithUser = Session & {
  user: Pick<User, 'id' | 'email' | 'role'>;
};

export type AuthRepository = {
  findUserByEmail(
    email: string,
  ): Promise<Pick<User, 'id' | 'email' | 'role' | 'passwordHash'> | null>;
  createSession(input: {
    userId: string;
    tokenFamilyId: string;
    expiresAt: Date;
  }): Promise<Pick<Session, 'id' | 'tokenFamilyId' | 'expiresAt'>>;
  findActiveSession(sessionId: string, now: Date): Promise<SessionWithUser | null>;
  revokeSession(sessionId: string, now: Date): Promise<void>;
};

export function createAuthRepository(prisma: PrismaClient): AuthRepository {
  return {
    async findUserByEmail(email) {
      return prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          role: true,
          passwordHash: true,
        },
      });
    },

    async createSession(input) {
      return prisma.session.create({
        data: input,
        select: {
          id: true,
          tokenFamilyId: true,
          expiresAt: true,
        },
      });
    },

    async findActiveSession(sessionId, now) {
      return prisma.session.findFirst({
        where: {
          id: sessionId,
          revokedAt: null,
          expiresAt: {
            gt: now,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
            },
          },
        },
      });
    },

    async revokeSession(sessionId, now) {
      await prisma.session.updateMany({
        where: {
          id: sessionId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });
    },
  };
}
