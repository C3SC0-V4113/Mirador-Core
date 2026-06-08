import { describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';

describe('internal core routes', () => {
  it('requires internal core configuration before exposing core ask', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/core/ask',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: {
        code: 'INTERNAL_CORE_NOT_CONFIGURED',
      },
    });

    await app.close();
  });
});
