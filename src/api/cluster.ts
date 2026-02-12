import type { Context } from 'hono';
import type { ClusterManager } from '../cluster.js';
import type { ClusterWsServer } from '../cluster-ws.js';
import { log } from '../logger.js';

/** POST /cluster/join — Hub node registers to cluster */
export function clusterJoinHandler(cluster: ClusterManager, wsServer?: ClusterWsServer) {
  return async (c: Context) => {
    const body = await c.req.json<{
      machine_id: string;
      bridge_url: string;
      capabilities?: string[];
    }>();

    if (!body.machine_id || !body.bridge_url) {
      return c.json({ error_code: 'MISSING_FIELDS', error: 'machine_id and bridge_url required' }, 400);
    }

    log.info('API', `POST /cluster/join from ${body.machine_id}`);

    const newMember = {
      machine_id: body.machine_id,
      type: 'hub' as const,
      bridge_url: body.bridge_url,
      capabilities: body.capabilities || [],
      agents: [],
      last_seen: Date.now(),
    };

    cluster.addMember(newMember);

    // Start heartbeat to the new hub
    cluster.startHubHeartbeat(cluster.getMember(body.machine_id)!);

    // Broadcast member_joined to connected Edge nodes
    if (wsServer) {
      wsServer.broadcastToEdges({ type: 'member_joined', member: newMember });
    }

    // Notify other Hubs about the new member
    broadcastToOtherHubs(cluster, body.machine_id, newMember);

    return c.json({ members: cluster.getMembers() });
  };
}

/** Notify other Hub nodes about a new member (fire-and-forget) */
async function broadcastToOtherHubs(
  cluster: ClusterManager,
  excludeId: string,
  newMember: { machine_id: string; bridge_url: string; capabilities: string[] },
): Promise<void> {
  const secret = cluster.getSecret();
  const hubs = cluster.getHubs().filter(
    (h) => h.machine_id !== cluster.getSelfId() && h.machine_id !== excludeId && h.bridge_url,
  );

  for (const hub of hubs) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (secret) headers['Authorization'] = `Bearer ${secret}`;
      await fetch(`${hub.bridge_url}/cluster/join`, {
        method: 'POST',
        headers,
        body: JSON.stringify(newMember),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Best-effort broadcast
    }
  }
}

/** GET /cluster/members — View cluster member list */
export function clusterMembersHandler(cluster: ClusterManager) {
  return async (c: Context) => {
    log.debug('API', 'GET /cluster/members');
    return c.json({ members: cluster.getMembers() });
  };
}

/** GET /health — Health check (used for Hub→Hub heartbeat) */
export function healthHandler(cluster: ClusterManager) {
  return async (c: Context) => {
    return c.json({
      status: 'ok',
      machine_id: cluster.getSelfId(),
      members: cluster.getMembers().length,
      uptime: process.uptime(),
    });
  };
}
