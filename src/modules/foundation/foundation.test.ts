import { describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';

const foundationRoutes = [
  { method: 'POST', url: '/api/auth/login' },
  { method: 'POST', url: '/api/auth/logout' },
  { method: 'GET', url: '/api/auth/session' },
  { method: 'POST', url: '/api/chat/messages' },
  { method: 'GET', url: '/api/chat/conversations' },
  { method: 'GET', url: '/api/schema/catalog' },
] as const;

describe('foundation routes', () => {
  it.each(foundationRoutes)('$method $url returns foundation-only response', async (route) => {
    const app = await buildApp();

    const response = await app.inject({
      method: route.method,
      url: route.url,
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toMatchObject({
      status: 'foundation_only',
    });

    await app.close();
  });
});
