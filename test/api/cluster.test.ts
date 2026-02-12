import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { ClusterManager } from '../../src/cluster.js';
import {
  clusterJoinHandler,
  clusterMembersHandler,
  healthHandler,
} from '../../src/api/cluster.js';

function postJSON(app: Hono, path: string, body: object) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Cluster API', () => {
  let cluster: ClusterManager;
  let app: Hono;

  beforeEach(() => {
    cluster = new ClusterManager('test-machine');
    // Stub startHubHeartbeat to avoid real timers
    vi.spyOn(cluster, 'startHubHeartbeat').mockImplementation(() => {});

    app = new Hono();
    app.post('/cluster/join', clusterJoinHandler(cluster));
    app.get('/cluster/members', clusterMembersHandler(cluster));
    app.get('/health', healthHandler(cluster));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /cluster/join', () => {
    it('adds member and returns member list', async () => {
      const res = await postJSON(app, '/cluster/join', {
        machine_id: 'node-a',
        bridge_url: 'http://node-a:9100',
        capabilities: ['openclaw'],
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.members).toHaveLength(1);
      expect(body.members[0].machine_id).toBe('node-a');
      expect(body.members[0].type).toBe('hub');
      expect(body.members[0].bridge_url).toBe('http://node-a:9100');
      expect(body.members[0].capabilities).toEqual(['openclaw']);
    });

    it('starts hub heartbeat for the new member', async () => {
      await postJSON(app, '/cluster/join', {
        machine_id: 'node-a',
        bridge_url: 'http://node-a:9100',
      });

      expect(cluster.startHubHeartbeat).toHaveBeenCalledTimes(1);
    });

    it('returns 400 if machine_id is missing', async () => {
      const res = await postJSON(app, '/cluster/join', {
        bridge_url: 'http://node-a:9100',
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error_code).toBe('MISSING_FIELDS');
      expect(body.error).toMatch(/machine_id and bridge_url required/);
    });

    it('returns 400 if bridge_url is missing', async () => {
      const res = await postJSON(app, '/cluster/join', {
        machine_id: 'node-a',
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error_code).toBe('MISSING_FIELDS');
    });

    it('returns 400 if both fields are missing', async () => {
      const res = await postJSON(app, '/cluster/join', {});
      expect(res.status).toBe(400);
    });

    it('defaults capabilities to empty array', async () => {
      const res = await postJSON(app, '/cluster/join', {
        machine_id: 'node-a',
        bridge_url: 'http://node-a:9100',
      });
      const body = await res.json();

      expect(body.members[0].capabilities).toEqual([]);
    });

    it('accumulates multiple members', async () => {
      await postJSON(app, '/cluster/join', {
        machine_id: 'node-a',
        bridge_url: 'http://node-a:9100',
      });
      const res = await postJSON(app, '/cluster/join', {
        machine_id: 'node-b',
        bridge_url: 'http://node-b:9100',
      });
      const body = await res.json();

      expect(body.members).toHaveLength(2);
    });
  });

  describe('GET /cluster/members', () => {
    it('returns empty members when no one has joined', async () => {
      const res = await app.request('/cluster/members');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.members).toEqual([]);
    });

    it('returns member list after joins', async () => {
      cluster.addMember({
        machine_id: 'node-x',
        type: 'hub',
        bridge_url: 'http://node-x:9100',
        capabilities: [],
        agents: ['agent-1'],
        last_seen: Date.now(),
      });

      const res = await app.request('/cluster/members');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.members).toHaveLength(1);
      expect(body.members[0].machine_id).toBe('node-x');
      expect(body.members[0].agents).toEqual(['agent-1']);
    });
  });

  describe('GET /health', () => {
    it('returns status ok with machine_id', async () => {
      const res = await app.request('/health');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.machine_id).toBe('test-machine');
      expect(typeof body.members).toBe('number');
      expect(typeof body.uptime).toBe('number');
    });

    it('reflects correct member count', async () => {
      cluster.addMember({
        machine_id: 'a',
        type: 'hub',
        capabilities: [],
        agents: [],
        last_seen: Date.now(),
      });
      cluster.addMember({
        machine_id: 'b',
        type: 'edge',
        capabilities: [],
        agents: [],
        last_seen: Date.now(),
      });

      const res = await app.request('/health');
      const body = await res.json();

      expect(body.members).toBe(2);
    });
  });
});
