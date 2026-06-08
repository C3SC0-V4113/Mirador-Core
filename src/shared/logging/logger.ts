import type { FastifyServerOptions } from 'fastify';

import { env } from '../../config/env.js';

export function createLoggerOptions(): FastifyServerOptions['logger'] {
  if (env.NODE_ENV === 'test') {
    return false;
  }

  return {
    level: env.LOG_LEVEL,
  };
}
