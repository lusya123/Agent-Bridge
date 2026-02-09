import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { spawnHandler } from '../../src/api/spawn.js';
import {
  createMockAdapter,
  createBridgeConfig,
  createClusterConfig,
} from '../helpers.js';

function buildApp(
  config = createBridgeConfig(),
  cluster = createClusterConfig(),
  adapters = [createMockAdapter()],
) {
  const app = new Hono();
  app.post('/spawn', spawnHandler(config, cluster, adapters));
  return { app, adapters };
}

function postJSON(app: Hono, path: string, body: object) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /spawn', () => {
  it('returns 400 when type is missing', async () => {
    const { app } = buildApp();

    const res = await postJSON(app, '/spawn', { task: 'do something' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/type and task are required/);
  });

  it('spawns agent locally via adapter and returns ok + agent_id', async () => {
    const adapter = createMockAdapter({ type: 'claude-code' });
    const config = createBridgeConfig();
    const cluster = createClusterConfig();
    const { app } = buildApp(config, cluster, [adapter]);

    const res = await postJSON(app, '/spawn', {
      type: 'claude-code',
      task: 'write tests',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.agent_id).toBeDefined();
    expect(body.machine).toBe('test-machine');
    expect(adapter.spawnAgent).toHaveBeenCalled();
  });

  it('returns 400 when no adapter matches the type', async () => {
    const adapter = createMockAdapter({ type: 'generic' });
    const config = createBridgeConfig();
    const cluster = createClusterConfig();
    const { app } = buildApp(config, cluster, [adapter]);

    const res = await postJSON(app, '/spawn', {
      type: 'claude-code',
      task: 'write tests',
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/No adapter for type/);
  });
});
  it('returns 400 when task is missing', async () => {
    const { app } = buildApp();

    const res = await postJSON(app, '/spawn', { type: 'generic' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/type and task are required/);
  });
