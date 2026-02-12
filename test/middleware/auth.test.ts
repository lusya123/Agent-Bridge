import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from '../../src/middleware/auth.js';

function buildApp(getSecret: () => string | null) {
  const app = new Hono();
  app.use('*', authMiddleware(getSecret));
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('authMiddleware', () => {
  it('returns 401 when no Authorization header', async () => {
    const app = buildApp(() => 'my-secret');
    const res = await app.request('/test');
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error_code).toBe('AUTH_REQUIRED');
    expect(body.error).toMatch(/Missing Authorization/);
  });

  it('returns 401 when wrong secret', async () => {
    const app = buildApp(() => 'correct-secret');
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error_code).toBe('AUTH_FAILED');
  });

  it('returns 401 when malformed header (not "Bearer xxx")', async () => {
    const app = buildApp(() => 'my-secret');

    // No "Bearer" prefix
    const res1 = await app.request('/test', {
      headers: { Authorization: 'Basic my-secret' },
    });
    expect(res1.status).toBe(401);

    // Missing space
    const res2 = await app.request('/test', {
      headers: { Authorization: 'Bearermy-secret' },
    });
    expect(res2.status).toBe(401);

    // Extra parts
    const res3 = await app.request('/test', {
      headers: { Authorization: 'Bearer my secret extra' },
    });
    expect(res3.status).toBe(401);
  });

  it('passes through when correct secret', async () => {
    const app = buildApp(() => 'my-secret');
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer my-secret' },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('passes through when secret is null (standalone mode)', async () => {
    const app = buildApp(() => null);
    const res = await app.request('/test');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
