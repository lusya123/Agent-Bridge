import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { stopHandler } from '../../src/api/stop.js';
import { createMockAdapter } from '../helpers.js';

function buildApp(adapters = [createMockAdapter()]) {
  const app = new Hono();
  app.post('/stop', stopHandler(adapters));
  return { app, adapters };
}

function postJSON(app: Hono, path: string, body: object) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /stop', () => {
  it('returns 400 when agent_id is missing', async () => {
    const { app } = buildApp();

    const res = await postJSON(app, '/stop', {});
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/agent_id is required/);
  });

  it('stops agent via adapter and returns ok', async () => {
    const adapter = createMockAdapter({
      agents: [
        { id: 'a1', type: 'generic', status: 'running', persistent: false },
      ],
    });
    const { app } = buildApp([adapter]);

    const res = await postJSON(app, '/stop', { agent_id: 'a1' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(adapter.stopAgent).toHaveBeenCalledWith('a1');
  });

  it('returns 404 when agent not found', async () => {
    const adapter = createMockAdapter({ agents: [] });
    const { app } = buildApp([adapter]);

    const res = await postJSON(app, '/stop', { agent_id: 'nonexistent' });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/not found/);
  });
});
