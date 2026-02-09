import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { agentsHandler } from '../../src/api/agents.js';
import { createMockAdapter } from '../helpers.js';

describe('GET /agents', () => {
  it('aggregates agents from multiple adapters', async () => {
    const adapter1 = createMockAdapter({
      type: 'openclaw',
      agents: [
        { id: 'a1', type: 'openclaw', status: 'running', persistent: false },
      ],
    });
    const adapter2 = createMockAdapter({
      type: 'claude-code',
      agents: [
        { id: 'a2', type: 'claude-code', status: 'idle', persistent: true },
      ],
    });

    const app = new Hono();
    app.get('/agents', agentsHandler([adapter1, adapter2]));

    const res = await app.request('/agents');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe('a1');
    expect(body[1].id).toBe('a2');
  });

  it('returns empty array when no adapters are registered', async () => {
    const app = new Hono();
    app.get('/agents', agentsHandler([]));

    const res = await app.request('/agents');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});
