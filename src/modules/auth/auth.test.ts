import { describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { env } from '../../config/env.js';
import { createFakePrisma } from '../../shared/testing/fake-prisma.js';
import { buildSessionCookieOptions } from './auth.service.js';

describe('auth routes', () => {
  it('logs in, returns a session cookie and resolves the current session', async () => {
    const prisma = await createFakePrisma();
    const app = await buildApp({ prisma });

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.CEO_EMAIL,
        password: 'mirador-dev-password',
      },
    });

    expect(loginResponse.statusCode).toBe(200);
    expect(loginResponse.headers['set-cookie']).toContain(`${env.SESSION_COOKIE_NAME}=`);
    expect(loginResponse.headers['set-cookie']).toContain('HttpOnly');

    const sessionResponse = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: {
        cookie: loginResponse.headers['set-cookie'] as string,
      },
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.json()).toMatchObject({
      user: {
        email: env.CEO_EMAIL,
        role: 'CEO',
      },
    });

    await app.close();
  });

  it('rejects invalid credentials', async () => {
    const prisma = await createFakePrisma();
    const app = await buildApp({ prisma });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.CEO_EMAIL,
        password: 'wrong-password',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: 'AUTH_INVALID_CREDENTIALS',
      },
    });

    await app.close();
  });

  it('revokes the current session on logout', async () => {
    const prisma = await createFakePrisma();
    const app = await buildApp({ prisma });

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.CEO_EMAIL,
        password: 'mirador-dev-password',
      },
    });
    const cookie = loginResponse.headers['set-cookie'] as string;

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });

    expect(logoutResponse.statusCode).toBe(200);

    const sessionResponse = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie },
    });

    expect(sessionResponse.statusCode).toBe(401);

    await app.close();
  });

  it('uses secure cookies only in production', () => {
    expect(buildSessionCookieOptions('development', 60).secure).toBe(false);
    expect(buildSessionCookieOptions('production', 60).secure).toBe(true);
  });
});
