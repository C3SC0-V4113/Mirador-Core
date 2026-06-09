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
});
