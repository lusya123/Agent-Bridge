import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { infoHandler } from '../../src/api/info.js';
import {
  createMockAdapter,
  createBridgeConfig,
} from '../helpers.js';

describe('GET /info', () => {
  it('returns correct machine_id, capabilities, and resources', async () => {
    const config = createBridgeConfig();
    const adapter = createMockAdapter({ agents: [] });
    const app = new Hono();
    app.get('/info', infoHandler(config, [adapter]));

    const res = await app.request('/info');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.machine_id).toBe('test-machine');
    expect(body.capabilities).toEqual(['openclaw']);
    expect(body.resources.running_agents).toBe(0);
    expect(body.resources.max_agents).toBe(5);
    expect(body.resources.cpu_cores).toBeGreaterThan(0);
    expect(body.resources.memory_gb).toBeGreaterThan(0);
  });

  it('aggregates running_agents count from multiple adapters', async () => {
    const config = createBridgeConfig();
    const adapter1 = createMockAdapter({
      type: 'openclaw',
      agents: [
        { id: 'a1', type: 'openclaw', status: 'running', persistent: false },
        { id: 'a2', type: 'openclaw', status: 'idle', persistent: true, description: 'CEO' },
      ],
    });
    const adapter2 = createMockAdapter({
      type: 'claude-code',
      agents: [
        { id: 'a3', type: 'claude-code', status: 'running', persistent: false },
      ],
    });

    const app = new Hono();
    app.get('/info', infoHandler(config, [adapter1, adapter2]));

    const res = await app.request('/info');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.resources.running_agents).toBe(3);
    // persistent_agents should only include the one marked persistent
    expect(body.persistent_agents).toHaveLength(1);
    expect(body.persistent_agents[0].id).toBe('a2');
    expect(body.persistent_agents[0].description).toBe('CEO');
  });
});
