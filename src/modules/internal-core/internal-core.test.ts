import { describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { env } from '../../config/env.js';

describe('internal core routes', () => {
  it('requires internal core configuration before exposing core ask', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/core/ask',
    });

    expect(response.statusCode).toBe(env.CORE_SERVICE_TOKEN === undefined ? 503 : 401);

    await app.close();
  });

  it('rejects an invalid bearer token on core ask', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/core/ask',
      headers: { authorization: 'Bearer definitely-not-the-token' },
      payload: { question: '¿cómo va el MRR?' },
    });

    // 401 cuando el token esta configurado; 503 si el servicio no esta configurado.
    expect(response.statusCode).toBe(env.CORE_SERVICE_TOKEN === undefined ? 503 : 401);

    await app.close();
  });

  it('guards the schema-catalog route behind the same service token', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/internal/core/schema-catalog',
    });

    expect(response.statusCode).toBe(env.CORE_SERVICE_TOKEN === undefined ? 503 : 401);

    await app.close();
  });
});
