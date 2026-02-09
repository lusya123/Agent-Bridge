import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { messageHandler } from '../../src/api/message.js';
import { Router } from '../../src/router.js';
import {
  createMockAdapter,
  createBridgeConfig,
  createClusterConfig,
} from '../helpers.js';

function buildApp(router: Router) {
  const app = new Hono();
  app.post('/message', messageHandler(router));
  return app;
}

function postJSON(app: Hono, path: string, body: object) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /message', () => {
  it('delivers message locally via adapter', async () => {
    const adapter = createMockAdapter({
      agents: [
        { id: 'a1', type: 'openclaw', status: 'running', persistent: false },
      ],
    });
    const config = createBridgeConfig();
    const cluster = createClusterConfig();
    const router = new Router(config, cluster, [adapter]);
    const app = buildApp(router);

    const res = await postJSON(app, '/message', {
      agent_id: 'a1',
      from: 'user',
      message: 'hello',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(adapter.sendMessage).toHaveBeenCalledWith('a1', 'user', 'hello');
  });

  it('returns 400 when agent_id is missing', async () => {
    const config = createBridgeConfig();
    const cluster = createClusterConfig();
    const router = new Router(config, cluster, []);
    const app = buildApp(router);

    const res = await postJSON(app, '/message', {
      message: 'hello',
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error_code).toBe('MISSING_FIELDS');
    expect(body.error).toMatch(/agent_id and message are required/);
  });

  it('returns 400 when message is missing', async () => {
    const config = createBridgeConfig();
    const cluster = createClusterConfig();
    const router = new Router(config, cluster, []);
    const app = buildApp(router);

    const res = await postJSON(app, '/message', {
      agent_id: 'a1',
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error_code).toBe('MISSING_FIELDS');
    expect(body.error).toMatch(/agent_id and message are required/);
  });

  it('returns 404 when agent is not found', async () => {
    const adapter = createMockAdapter({ agents: [] });
    const config = createBridgeConfig();
    const cluster = createClusterConfig();
    const router = new Router(config, cluster, [adapter]);
    const app = buildApp(router);

    const res = await postJSON(app, '/message', {
      agent_id: 'nonexistent',
      from: 'user',
      message: 'hello',
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error_code).toBe('AGENT_NOT_FOUND');
    expect(body.error).toMatch(/not found/);
  });
});
