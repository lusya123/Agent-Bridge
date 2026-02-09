import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { locateHandler } from '../../src/api/locate.js';
import {
  createMockAdapter,
  createBridgeConfig,
  createClusterConfig,
} from '../helpers.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /locate', () => {
  it('finds agent on a local adapter', async () => {
    const config = createBridgeConfig({ port: 9100 });
    const cluster = createClusterConfig();
    const adapter = createMockAdapter({
      type: 'openclaw',
      agents: [
        { id: 'agent-1', type: 'openclaw', status: 'running', persistent: false },
      ],
    });

    const app = new Hono();
    app.get('/locate', locateHandler(config, cluster, [adapter]));

    const res = await app.request('/locate?agent_id=agent-1');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.agent_id).toBe('agent-1');
    expect(body.machine).toBe('test-machine');
    expect(body.bridge).toBe('http://127.0.0.1:9100');
    expect(body.type).toBe('openclaw');
  });

  it('returns 400 when agent_id query param is missing', async () => {
    const config = createBridgeConfig();
    const cluster = createClusterConfig();

    const app = new Hono();
    app.get('/locate', locateHandler(config, cluster, []));

    const res = await app.request('/locate');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error_code).toBe('MISSING_AGENT_ID');
    expect(body.error).toMatch(/agent_id is required/);
  });

  it('returns 404 when agent is not found', async () => {
    const config = createBridgeConfig();
    const cluster = createClusterConfig();
    const adapter = createMockAdapter({ agents: [] });

    const app = new Hono();
    app.get('/locate', locateHandler(config, cluster, [adapter]));

    const res = await app.request('/locate?agent_id=nonexistent');
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error_code).toBe('AGENT_NOT_FOUND');
    expect(body.error).toMatch(/not found/);
  });

  it('finds agent on remote machine when local misses', async () => {
    const config = createBridgeConfig({ machine_id: 'local-machine' });
    const cluster = createClusterConfig([
      { id: 'remote-1', bridge: 'http://remote-1:9100', role: 'worker' },
    ]);
    const adapter = createMockAdapter({ agents: [] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'agent-remote', type: 'claude-code' }],
    } as Response);

    const app = new Hono();
    app.get('/locate', locateHandler(config, cluster, [adapter]));

    const res = await app.request('/locate?agent_id=agent-remote');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.machine).toBe('remote-1');
    expect(body.bridge).toBe('http://remote-1:9100');
    expect(body.type).toBe('claude-code');
  });

  it('returns 502 with REMOTE_UNREACHABLE when remote lookup throws', async () => {
    const config = createBridgeConfig({ machine_id: 'local-machine' });
    const cluster = createClusterConfig([
      { id: 'remote-1', bridge: 'http://remote-1:9100', role: 'worker' },
    ]);
    const adapter = createMockAdapter({ agents: [] });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const app = new Hono();
    app.get('/locate', locateHandler(config, cluster, [adapter]));

    const res = await app.request('/locate?agent_id=ghost');
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error_code).toBe('REMOTE_UNREACHABLE');
    expect(body.error).toMatch(/Failed to fully query cluster/);
    expect(body.detail).toMatch(/network down/);
  });
});
