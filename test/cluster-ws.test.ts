import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import WebSocket from 'ws';
import { ClusterWsServer, ClusterWsClient } from '../src/cluster-ws.js';
import { ClusterManager } from '../src/cluster.js';

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on('open', resolve);
  });
}

function waitForMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe('ClusterWsServer', () => {
  let httpServer: Server;
  let serverPort: number;
  let hubCluster: ClusterManager;
  let wsServer: ClusterWsServer;

  beforeEach(async () => {
    hubCluster = new ClusterManager('hub-1');
    hubCluster.setSecret('test-secret');
    hubCluster.addMember({
      machine_id: 'hub-1',
      type: 'hub',
      bridge_url: 'http://localhost:9100',
      capabilities: ['openclaw'],
      agents: [],
      last_seen: Date.now(),
    });

    wsServer = new ClusterWsServer(hubCluster);

    httpServer = createServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    serverPort = (httpServer.address() as any).port;
    wsServer.attachToServer(httpServer);
  });

  afterEach(() => {
    wsServer.close();
    httpServer.close();
  });

  it('accepts Edge join with correct secret and sends welcome', async () => {
    const ws = new WebSocket(`ws://localhost:${serverPort}/cluster/ws`);
    await waitForOpen(ws);

    ws.send(JSON.stringify({
      type: 'join',
      secret: 'test-secret',
      machine_id: 'edge-1',
      capabilities: ['claude-code'],
    }));

    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('welcome');
    expect(msg.hub_id).toBe('hub-1');
    expect(msg.members).toBeInstanceOf(Array);
    expect(msg.members.length).toBeGreaterThanOrEqual(2); // hub-1 + edge-1

    // Edge should be registered in cluster
    const edge = hubCluster.getMember('edge-1');
    expect(edge).toBeDefined();
    expect(edge!.type).toBe('edge');
    expect(edge!.connected_hub).toBe('hub-1');

    ws.close();
  });

  it('rejects Edge join with wrong secret', async () => {
    const ws = new WebSocket(`ws://localhost:${serverPort}/cluster/ws`);
    await waitForOpen(ws);

    ws.send(JSON.stringify({
      type: 'join',
      secret: 'wrong-secret',
      machine_id: 'edge-bad',
      capabilities: [],
    }));

    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('error');
    expect(msg.code).toBe('AUTH_FAILED');

    // Wait for close
    await new Promise<void>((resolve) => ws.on('close', resolve));
  });

  it('removes Edge member on disconnect', async () => {
    const ws = new WebSocket(`ws://localhost:${serverPort}/cluster/ws`);
    await waitForOpen(ws);

    ws.send(JSON.stringify({
      type: 'join',
      secret: 'test-secret',
      machine_id: 'edge-2',
      capabilities: [],
    }));

    await waitForMessage(ws); // welcome

    expect(hubCluster.getMember('edge-2')).toBeDefined();

    ws.close();
    // Wait a bit for close handler
    await new Promise((r) => setTimeout(r, 50));

    expect(hubCluster.getMember('edge-2')).toBeUndefined();
  });

  it('responds to ping with pong', async () => {
    const ws = new WebSocket(`ws://localhost:${serverPort}/cluster/ws`);
    await waitForOpen(ws);

    ws.send(JSON.stringify({
      type: 'join',
      secret: 'test-secret',
      machine_id: 'edge-3',
      capabilities: [],
    }));

    await waitForMessage(ws); // welcome

    ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await waitForMessage(ws);
    expect(pong.type).toBe('pong');

    ws.close();
  });

  it('relays message to connected Edge', async () => {
    const ws = new WebSocket(`ws://localhost:${serverPort}/cluster/ws`);
    await waitForOpen(ws);

    ws.send(JSON.stringify({
      type: 'join',
      secret: 'test-secret',
      machine_id: 'edge-4',
      capabilities: [],
    }));

    await waitForMessage(ws); // welcome

    const relayed = wsServer.relayToEdge('edge-4', '/message', {
      agent_id: 'worker-1',
      message: 'hello',
      from: 'ceo',
    });
    expect(relayed).toBe(true);

    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('relay');
    expect(msg.payload.path).toBe('/message');
    expect(msg.payload.body.agent_id).toBe('worker-1');

    ws.close();
  });

  it('returns false when relaying to non-existent Edge', () => {
    const result = wsServer.relayToEdge('non-existent', '/message', {});
    expect(result).toBe(false);
  });

  it('hasEdge returns true for connected Edge', async () => {
    const ws = new WebSocket(`ws://localhost:${serverPort}/cluster/ws`);
    await waitForOpen(ws);

    ws.send(JSON.stringify({
      type: 'join',
      secret: 'test-secret',
      machine_id: 'edge-5',
      capabilities: [],
    }));

    await waitForMessage(ws); // welcome

    expect(wsServer.hasEdge('edge-5')).toBe(true);
    expect(wsServer.hasEdge('non-existent')).toBe(false);

    ws.close();
  });
});

describe('ClusterWsClient', () => {
  let httpServer: Server;
  let serverPort: number;
  let hubCluster: ClusterManager;
  let wsServer: ClusterWsServer;

  beforeEach(async () => {
    hubCluster = new ClusterManager('hub-1');
    hubCluster.setSecret('test-secret');
    hubCluster.addMember({
      machine_id: 'hub-1',
      type: 'hub',
      bridge_url: 'http://localhost:9100',
      capabilities: [],
      agents: [],
      last_seen: Date.now(),
    });

    wsServer = new ClusterWsServer(hubCluster);

    httpServer = createServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    serverPort = (httpServer.address() as any).port;
    wsServer.attachToServer(httpServer);
  });

  afterEach(() => {
    wsServer.close();
    httpServer.close();
  });

  it('connects to Hub and receives welcome with members', async () => {
    const edgeCluster = new ClusterManager('edge-1');
    const client = new ClusterWsClient(
      edgeCluster,
      'edge-1',
      'test-secret',
      ['claude-code'],
      `localhost:${serverPort}`,
    );

    await client.connect();

    expect(client.isConnected()).toBe(true);
    // Edge should have received hub-1 in its cluster
    expect(edgeCluster.getMember('hub-1')).toBeDefined();

    client.disconnect();
  });

  it('receives relay messages from Hub', async () => {
    const edgeCluster = new ClusterManager('edge-relay');
    const client = new ClusterWsClient(
      edgeCluster,
      'edge-relay',
      'test-secret',
      [],
      `localhost:${serverPort}`,
    );

    const relayReceived = new Promise<{ path: string; body: Record<string, unknown> }>((resolve) => {
      client.setRelayHandler((path, body) => resolve({ path, body }));
    });

    await client.connect();

    // Hub sends relay
    wsServer.relayToEdge('edge-relay', '/message', {
      agent_id: 'worker-1',
      message: 'test',
    });

    const relay = await relayReceived;
    expect(relay.path).toBe('/message');
    expect(relay.body.agent_id).toBe('worker-1');

    client.disconnect();
  });

  it('fails to connect with wrong secret', async () => {
    const edgeCluster = new ClusterManager('edge-bad');
    const client = new ClusterWsClient(
      edgeCluster,
      'edge-bad',
      'wrong-secret',
      [],
      `localhost:${serverPort}`,
    );

    await expect(client.connect()).rejects.toThrow();

    client.disconnect();
  });
});

describe('Router Edge relay', () => {
  it('relays to Edge via WebSocket when target is Edge node', async () => {
    // Import Router
    const { Router } = await import('../src/router.js');

    const cluster = new ClusterManager('hub-1');
    cluster.setSecret('test-secret');
    cluster.addMember({
      machine_id: 'edge-1',
      type: 'edge',
      connected_hub: 'hub-1',
      capabilities: [],
      agents: ['worker-1'],
      last_seen: Date.now(),
    });

    const mockAdapter = {
      type: 'generic' as const,
      sendMessage: vi.fn(),
      listAgents: vi.fn(async () => []),
      hasAgent: vi.fn(async () => false),
      spawnAgent: vi.fn(),
      stopAgent: vi.fn(),
    };

    const config = {
      machine_id: 'hub-1',
      port: 9100,
      capabilities: ['openclaw'] as any,
      max_agents: 5,
      persistent_agents: [],
      adapters: {},
    };

    const router = new Router(config, { machines: [] }, [mockAdapter], cluster);

    // Create a mock WsServer
    const mockWsServer = {
      relayToEdge: vi.fn(() => true),
      hasEdge: vi.fn(() => true),
      attachToServer: vi.fn(),
      broadcastToEdges: vi.fn(),
      close: vi.fn(),
    };
    router.setWsServer(mockWsServer as any);

    // Deliver to edge-1 with explicit target
    await router.deliver('worker-1', 'ceo', 'hello', 'edge-1');

    expect(mockWsServer.relayToEdge).toHaveBeenCalledWith(
      'edge-1',
      '/message',
      { agent_id: 'worker-1', from: 'ceo', message: 'hello' },
    );
  });
});

describe('agents_sync', () => {
  let httpServer: Server;
  let serverPort: number;
  let hubCluster: ClusterManager;
  let wsServer: ClusterWsServer;

  beforeEach(async () => {
    hubCluster = new ClusterManager('hub-1');
    hubCluster.setSecret('test-secret');
    hubCluster.addMember({
      machine_id: 'hub-1',
      type: 'hub',
      bridge_url: 'http://localhost:9100',
      capabilities: [],
      agents: [],
      last_seen: Date.now(),
    });

    wsServer = new ClusterWsServer(hubCluster);
    httpServer = createServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    serverPort = (httpServer.address() as any).port;
    wsServer.attachToServer(httpServer);
  });

  afterEach(() => {
    wsServer.close();
    httpServer.close();
  });

  it('Edge syncs agent list to Hub via agents_sync message', async () => {
    const edgeCluster = new ClusterManager('edge-sync');
    const client = new ClusterWsClient(
      edgeCluster,
      'edge-sync',
      'test-secret',
      [],
      `localhost:${serverPort}`,
    );

    await client.connect();

    // Sync agents
    client.syncAgents(['agent-a', 'agent-b']);

    // Wait a bit for the message to be processed
    await new Promise((r) => setTimeout(r, 50));

    const edgeMember = hubCluster.getMember('edge-sync');
    expect(edgeMember).toBeDefined();
    expect(edgeMember!.agents).toEqual(['agent-a', 'agent-b']);

    client.disconnect();
  });
});
