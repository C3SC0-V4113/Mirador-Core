import type { FastifyInstance } from 'fastify';

export function registerPrisma(app: FastifyInstance) {
  // Prisma schema and scripts are present. Runtime connection is intentionally deferred
  // until the first domain module needs database access.
  app.log.trace('Prisma runtime connection deferred for foundation scaffold');
}
