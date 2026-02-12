import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { Router } from './router.js';
import { HeartbeatManager } from './heartbeat.js';
import { OpenClawAdapter } from './adapters/openclaw.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.js';
import type { Adapter } from './adapters/types.js';
import { infoHandler } from './api/info.js';
import { agentsHandler } from './api/agents.js';
import { locateHandler } from './api/locate.js';
import { messageHandler } from './api/message.js';
import { spawnHandler } from './api/spawn.js';
import { stopHandler } from './api/stop.js';
import { testMessagesHandler } from './api/test-messages.js';
import { clusterJoinHandler, clusterMembersHandler, healthHandler } from './api/cluster.js';
import { authMiddleware } from './middleware/auth.js';
import { ClusterManager } from './cluster.js';
import { generateSecret, buildToken, parseToken, persistToken, loadPersistedToken } from './token.js';
import { ClusterWsServer, ClusterWsClient } from './cluster-ws.js';
import { log } from './logger.js';

export async function main() {
  const { bridge: config, cluster: staticCluster } = loadConfig();
  const adapters: Adapter[] = [];

  // --- Token & Cluster setup ---
  const clusterMgr = new ClusterManager(config.machine_id);

  // Resolve token: CLI arg > persisted > generate new
  let tokenStr = process.env.BRIDGE_TOKEN || loadPersistedToken();
  const publicIp = process.env.BRIDGE_PUBLIC_IP;

  if (tokenStr) {
    // Joining an existing cluster
    const parsed = parseToken(tokenStr);
    clusterMgr.setSecret(parsed.secret);
    persistToken(tokenStr);
  } else {
    // First machine — generate token
    const secret = generateSecret();
    clusterMgr.setSecret(secret);
    if (publicIp) {
      tokenStr = buildToken(secret, `${publicIp}:${config.port}`);
      persistToken(tokenStr);
    }
    // If no public IP, token will be shown once IP is known
  }

  // Register self as a member
  const selfType = publicIp ? 'hub' : (tokenStr && !publicIp ? 'edge' : 'hub');
  clusterMgr.addMember({
    machine_id: config.machine_id,
    type: selfType as 'hub' | 'edge',
    bridge_url: publicIp ? `http://${publicIp}:${config.port}` : undefined,
    capabilities: config.capabilities,
    agents: [],
    last_seen: Date.now(),
  });

  // initialize OpenClaw adapter
  if (config.capabilities.includes('openclaw') && config.adapters.openclaw) {
    const oc = new OpenClawAdapter(config.adapters.openclaw.gateway, config.adapters.openclaw.token);
    try {
      await oc.connect();
      adapters.push(oc);
    } catch (err) {
      log.warn('Bridge', 'OpenClaw adapter failed to connect, skipping:',
        err instanceof Error ? err.message : err);
    }
  }

  // initialize Claude Code adapter
  if (config.capabilities.includes('claude-code') && config.adapters.claude_code) {
    const cc = new ClaudeCodeAdapter(config.adapters.claude_code.tmux_session);
    try {
      await cc.connect();
      adapters.push(cc);
    } catch (err) {
      log.warn('Bridge', 'Claude Code adapter failed to connect, skipping:',
        err instanceof Error ? err.message : err);
    }
  }

  // initialize Test adapter (for integration testing without real services)
  if (config.capabilities.includes('test')) {
    const { TestAdapter } = await import('./adapters/test.js');
    const ta = new TestAdapter();
    await ta.connect();
    adapters.push(ta);
  }

  // Use ClusterManager's legacy view for Router (backward compat)
  // Also merge in any static cluster machines
  const dynamicCluster = clusterMgr.toLegacyCluster();
  for (const m of staticCluster.machines) {
    if (!dynamicCluster.machines.some((dm) => dm.id === m.id)) {
      dynamicCluster.machines.push(m);
    }
  }

  const router = new Router(config, dynamicCluster, adapters, clusterMgr);
  const heartbeat = new HeartbeatManager();
  heartbeat.load(resolve('data/heartbeats.json'));

  const app = new Hono();

  // Auth middleware — protects all routes except /health (which does its own check)
  const auth = authMiddleware(() => clusterMgr.getSecret());
  app.use('*', async (c, next) => {
    // /health is public for Hub heartbeat probes
    if (c.req.path === '/health') return next();
    return auth(c, next);
  });

  // register routes
  app.get('/info', infoHandler(config, adapters));
  app.get('/agents', agentsHandler(adapters, clusterMgr));
  app.get('/locate', locateHandler(config, dynamicCluster, adapters));
  app.post('/message', messageHandler(router));
  app.post('/spawn', spawnHandler(config, dynamicCluster, adapters, heartbeat));
  app.post('/stop', stopHandler(adapters, heartbeat));
  app.get('/test/messages', testMessagesHandler(adapters));

  // Cluster endpoints
  app.post('/cluster/join', clusterJoinHandler(clusterMgr));
  app.get('/cluster/members', clusterMembersHandler(clusterMgr));
  app.get('/health', healthHandler(clusterMgr));

  const port = config.port;
  log.info('Bridge', `Starting on :${port}`);
  log.info('Bridge', `Machine: ${config.machine_id}`);
  log.info('Bridge', `Capabilities: ${config.capabilities.join(', ')}`);
  log.info('Bridge', `Adapters: ${adapters.map((a) => a.type).join(', ') || 'none'}`);
  log.info('Bridge', `Cluster: ${clusterMgr.getMembers().length} members`);
  log.info('Bridge', `Heartbeats: ${heartbeat.list().length} active`);

  if (tokenStr) {
    log.info('Bridge', `Cluster token: ${tokenStr}`);
  } else if (clusterMgr.getSecret()) {
    log.info('Bridge', `Secret: ${clusterMgr.getSecret()} (use --public-ip to generate full token)`);
  }

  // If we have a token and it points to another hub, register with it
  if (tokenStr && publicIp) {
    const parsed = parseToken(tokenStr);
    const selfUrl = `http://${publicIp}:${config.port}`;
    const hubUrl = `http://${parsed.hubAddress}`;
    // Don't join ourselves
    if (hubUrl !== selfUrl) {
      try {
        const res = await fetch(`${hubUrl}/cluster/join`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${parsed.secret}`,
          },
          body: JSON.stringify({
            machine_id: config.machine_id,
            bridge_url: selfUrl,
            capabilities: config.capabilities,
          }),
        });
        if (res.ok) {
          const data = await res.json() as { members: Array<{ machine_id: string; type: string; bridge_url?: string; capabilities?: string[]; agents?: string[] }> };
          for (const m of data.members) {
            if (m.machine_id !== config.machine_id) {
              clusterMgr.addMember({
                machine_id: m.machine_id,
                type: (m.type as 'hub' | 'edge') || 'hub',
                bridge_url: m.bridge_url,
                capabilities: m.capabilities || [],
                agents: m.agents || [],
                last_seen: Date.now(),
              });
              if (m.type === 'hub' && m.bridge_url) {
                clusterMgr.startHubHeartbeat(clusterMgr.getMember(m.machine_id)!);
              }
            }
          }
          log.info('Bridge', `Joined cluster via ${parsed.hubAddress}`);
        } else {
          log.warn('Bridge', `Failed to join cluster: ${res.status}`);
        }
      } catch (err) {
        log.warn('Bridge', 'Failed to join cluster:',
          err instanceof Error ? err.message : err);
      }
    }
  }

  const server = serve({ fetch: app.fetch, port });

  // --- WebSocket setup ---
  let wsServer: ClusterWsServer | null = null;
  let wsClient: ClusterWsClient | null = null;

  if (selfType === 'hub') {
    // Hub: start WebSocket server for Edge connections
    wsServer = new ClusterWsServer(clusterMgr);
    wsServer.attachToServer(server as any);
    router.setWsServer(wsServer);
    log.info('Bridge', 'Hub mode: WebSocket server ready for Edge connections');
  } else if (selfType === 'edge' && tokenStr) {
    // Edge: connect to Hub via WebSocket
    const parsed = parseToken(tokenStr);
    wsClient = new ClusterWsClient(
      clusterMgr,
      config.machine_id,
      parsed.secret,
      config.capabilities,
      parsed.hubAddress,
    );

    // Handle relay messages from Hub
    wsClient.setRelayHandler(async (path, body) => {
      try {
        if (path === '/message' && body.agent_id) {
          await router.deliver(
            body.agent_id as string,
            (body.from as string) || 'unknown',
            (body.message as string) || '',
          );
        } else if (path === '/spawn' && body.task) {
          for (const adapter of adapters) {
            try {
              await adapter.spawnAgent?.(body as any);
              break;
            } catch { /* try next adapter */ }
          }
        }
      } catch (err) {
        log.warn('Bridge', `Failed to handle relay ${path}:`,
          err instanceof Error ? err.message : err);
      }
    });

    // Connect in background (don't block startup)
    wsClient.connect().catch((err) => {
      log.warn('Bridge', 'Edge WebSocket connection failed, will retry:',
        err instanceof Error ? err.message : err);
    });
    log.info('Bridge', 'Edge mode: connecting to Hub via WebSocket');
  }

  return { app, clusterMgr, router, wsServer, wsClient };
}

// Only auto-start when run directly (not when imported by cli.ts)
const isDirectRun = process.argv[1]?.endsWith('/index.js') || process.argv[1]?.endsWith('/index.ts');
if (isDirectRun) {
  main().catch((err) => {
    log.error('Bridge', 'Fatal:', err);
    process.exit(1);
  });
}
