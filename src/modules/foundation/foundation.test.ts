import { describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { env } from '../../config/env.js';
import { createFakePrisma } from '../../shared/testing/fake-prisma.js';

describe('foundation route boundaries', () => {
  it('requires authentication before exposing reserved chat routes', async () => {
    const app = await buildApp({ prisma: await createFakePrisma() });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/messages',
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it('keeps chat behavior reserved after CEO authentication', async () => {
    const app = await buildApp({ prisma: await createFakePrisma() });
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.CEO_EMAIL,
        password: 'mirador-dev-password',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/messages',
      headers: {
        cookie: loginResponse.headers['set-cookie'] as string,
      },
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toMatchObject({
      status: 'foundation_only',
      capability: 'chat.messages',
    });

    await app.close();
  });
});
