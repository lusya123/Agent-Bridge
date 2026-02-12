import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { agentsHandler } from '../../src/api/agents.js';
import { createMockAdapter } from '../helpers.js';
import { ClusterManager } from '../../src/cluster.js';

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

  it('returns local agents without scope param even with clusterMgr', async () => {
    const cluster = new ClusterManager('self');
    cluster.addMember({
      machine_id: 'other',
      type: 'hub',
      bridge_url: 'http://other:9100',
      capabilities: [],
      agents: ['remote-agent'],
      last_seen: Date.now(),
    });

    const adapter = createMockAdapter({
      agents: [{ id: 'local-1', type: 'openclaw', status: 'running', persistent: false }],
    });

    const app = new Hono();
    app.get('/agents', agentsHandler([adapter], cluster));

    const res = await app.request('/agents');
    const body = await res.json();

    expect(res.status).toBe(200);
    // Without scope=cluster, returns flat local agents
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('local-1');
  });

  it('returns cluster-wide view with scope=cluster', async () => {
    const cluster = new ClusterManager('self');
    cluster.addMember({
      machine_id: 'self',
      type: 'hub',
      bridge_url: 'http://self:9100',
      capabilities: [],
      agents: [],
      last_seen: Date.now(),
    });
    cluster.addMember({
      machine_id: 'other',
      type: 'hub',
      bridge_url: 'http://other:9100',
      capabilities: [],
      agents: ['remote-agent-1', 'remote-agent-2'],
      last_seen: Date.now(),
    });

    const adapter = createMockAdapter({
      agents: [{ id: 'local-1', type: 'openclaw', status: 'running', persistent: false }],
    });

    const app = new Hono();
    app.get('/agents', agentsHandler([adapter], cluster));

    const res = await app.request('/agents?scope=cluster');
    const body = await res.json() as Array<{ machine_id: string; agents: Array<{ id: string }> }>;

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);

    const selfEntry = body.find((e) => e.machine_id === 'self');
    expect(selfEntry).toBeDefined();
    expect(selfEntry!.agents).toHaveLength(1);
    expect(selfEntry!.agents[0].id).toBe('local-1');

    const otherEntry = body.find((e) => e.machine_id === 'other');
    expect(otherEntry).toBeDefined();
    expect(otherEntry!.agents).toHaveLength(2);
  });

  it('excludes members with no agents from cluster view', async () => {
    const cluster = new ClusterManager('self');
    cluster.addMember({
      machine_id: 'self',
      type: 'hub',
      capabilities: [],
      agents: [],
      last_seen: Date.now(),
    });
    cluster.addMember({
      machine_id: 'empty-node',
      type: 'hub',
      capabilities: [],
      agents: [],
      last_seen: Date.now(),
    });

    const app = new Hono();
    app.get('/agents', agentsHandler([], cluster));

    const res = await app.request('/agents?scope=cluster');
    const body = await res.json() as Array<{ machine_id: string }>;

    // Only self (even with 0 agents), empty-node excluded
    expect(body).toHaveLength(1);
    expect(body[0].machine_id).toBe('self');
  });
});
