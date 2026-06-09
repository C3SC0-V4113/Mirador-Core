import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { env } from '../../config/env.js';

declare module 'fastify' {
  // Fastify instance augmentation requires an interface declaration.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export function createPrismaClient(connectionString: string) {
  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({ adapter });
}

export function createReadonlyPrismaClient() {
  return createPrismaClient(env.DATABASE_URL_READONLY);
}

export function registerPrisma(app: FastifyInstance, prismaClient?: PrismaClient) {
  const prisma = prismaClient ?? createPrismaClient(env.DATABASE_URL_APP);

  app.decorate('prisma', prisma);

  if (prismaClient === undefined) {
    app.addHook('onClose', async () => {
      await prisma.$disconnect();
    });
  }
}
