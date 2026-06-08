import type { FastifyReply } from 'fastify';

export function sendFoundationOnly(reply: FastifyReply, capability: string) {
  return reply.status(501).send({
    status: 'foundation_only',
    capability,
    message: 'Route reserved in the mirador-core scaffold; domain behavior is not implemented yet.',
  });
}
