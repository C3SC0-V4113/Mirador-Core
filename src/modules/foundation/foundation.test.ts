import { describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { createFakePrisma } from '../../shared/testing/fake-prisma.js';

describe('chat route boundaries', () => {
  it('requires authentication before exposing chat routes', async () => {
    const app = await buildApp({ prisma: await createFakePrisma() });

    const messages = await app.inject({ method: 'POST', url: '/api/chat/messages' });
    const conversations = await app.inject({ method: 'GET', url: '/api/chat/conversations' });

    expect(messages.statusCode).toBe(401);
    expect(conversations.statusCode).toBe(401);

    await app.close();
  });
});
