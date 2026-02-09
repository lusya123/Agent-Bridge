import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { spawnHandler } from '../../src/api/spawn.js';
import {
  createMockAdapter,
  createBridgeConfig,
  createClusterConfig,
} from '../helpers.js';

function createMockHeartbeat() {
  return {
    add: vi.fn(),
    remove: vi.fn(),
    list: vi.fn(() => []),
    stopAll: vi.fn(),
    load: vi.fn(),
  };
}

function buildApp(
  config = createBridgeConfig(),
  cluster = createClusterConfig(),
  adapters = [createMockAdapter()],
  heartbeatManager?: ReturnType<typeof createMockHeartbeat>,
) {
  const app = new Hono();
  app.post('/spawn', spawnHandler(config, cluster, adapters, heartbeatManager as any));
  return { app, adapters, heartbeatManager };
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
    expect(body.error_code).toBe('MISSING_FIELDS');
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
    expect(body.error_code).toBe('NO_ADAPTER');
    expect(body.error).toMatch(/No adapter for type/);
  });

  it('registers heartbeat when spawn includes heartbeat config', async () => {
    const adapter = createMockAdapter({ type: 'claude-code' });
    const config = createBridgeConfig();
    const cluster = createClusterConfig();
    const hbm = createMockHeartbeat();
    const { app } = buildApp(config, cluster, [adapter], hbm);

    const res = await postJSON(app, '/spawn', {
      type: 'claude-code',
      task: 'run experiment',
      heartbeat: { hourly: '[心跳] check progress' },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(hbm.add).toHaveBeenCalledWith(
      body.agent_id,
      { hourly: '[心跳] check progress' },
      config.port,
    );
  });

  it('does not register heartbeat when heartbeat config is absent', async () => {
    const adapter = createMockAdapter({ type: 'claude-code' });
    const config = createBridgeConfig();
    const cluster = createClusterConfig();
    const hbm = createMockHeartbeat();
    const { app } = buildApp(config, cluster, [adapter], hbm);

    await postJSON(app, '/spawn', {
      type: 'claude-code',
      task: 'simple task',
    });

    expect(hbm.add).not.toHaveBeenCalled();
  });
});
  it('returns 400 when task is missing', async () => {
    const { app } = buildApp();

    const res = await postJSON(app, '/spawn', { type: 'generic' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error_code).toBe('MISSING_FIELDS');
    expect(body.error).toMatch(/type and task are required/);
  });
