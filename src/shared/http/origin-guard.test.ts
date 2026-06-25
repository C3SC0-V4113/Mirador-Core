import { describe, expect, it } from 'vitest';

import { isForbiddenApiOrigin } from './origin-guard.js';

const SECRET = 'cloudflare-shared-secret';

describe('isForbiddenApiOrigin', () => {
  it('rejects /api/* requests without the origin header', () => {
    expect(isForbiddenApiOrigin('/api/chat/messages', undefined, SECRET)).toBe(true);
  });

  it('rejects /api/* requests with the wrong secret', () => {
    expect(isForbiddenApiOrigin('/api/chat/messages', 'wrong', SECRET)).toBe(true);
  });

  it('allows /api/* requests with the correct secret', () => {
    expect(isForbiddenApiOrigin('/api/chat/messages', SECRET, SECRET)).toBe(false);
  });

  it('reads the first value when the header arrives as an array', () => {
    expect(isForbiddenApiOrigin('/api/chat/messages', [SECRET, 'extra'], SECRET)).toBe(false);
  });

  it('never guards /health (internal Railway healthcheck)', () => {
    expect(isForbiddenApiOrigin('/health', undefined, SECRET)).toBe(false);
  });

  it('never guards /internal/* (private network + CORE_SERVICE_TOKEN)', () => {
    expect(isForbiddenApiOrigin('/internal/core/ask', undefined, SECRET)).toBe(false);
  });
});
