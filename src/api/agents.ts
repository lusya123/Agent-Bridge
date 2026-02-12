import type { Context } from 'hono';
import type { Adapter } from '../adapters/types.js';
import type { ClusterManager } from '../cluster.js';
import { log } from '../logger.js';

export function agentsHandler(adapters: Adapter[], clusterMgr?: ClusterManager) {
  return async (c: Context) => {
    const scope = c.req.query('scope');
    log.debug('API', `GET /agents${scope ? `?scope=${scope}` : ''}`);

    // Local agents from adapters
    const localAgents = [];
    for (const adapter of adapters) {
      const agents = await adapter.listAgents();
      localAgents.push(...agents);
    }

    if (scope !== 'cluster' || !clusterMgr) {
      return c.json(localAgents);
    }

    // Cluster-wide view: local agents + agents from other members
    const selfId = clusterMgr.getSelfId();
    const result: Array<{
      machine_id: string;
      agents: Array<{ id: string; type?: string; status?: string }>;
    }> = [];

    // Add local agents
    result.push({
      machine_id: selfId,
      agents: localAgents.map((a) => ({ id: a.id, type: a.type, status: a.status })),
    });

    // Fetch agents from other Hub members in real-time
    const secret = clusterMgr.getSecret();
    const remoteMembers = clusterMgr.getMembers().filter(
      (m) => m.machine_id !== selfId && m.type === 'hub' && m.bridge_url,
    );

    const fetches = remoteMembers.map(async (member) => {
      try {
        const headers: Record<string, string> = {};
        if (secret) headers['Authorization'] = `Bearer ${secret}`;
        const res = await fetch(`${member.bridge_url}/agents`, {
          headers,
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const agents = (await res.json()) as Array<{ id: string; type?: string; status?: string }>;
          return { machine_id: member.machine_id, agents };
        }
      } catch (err) {
        log.warn('API', `Failed to fetch agents from ${member.machine_id}:`,
          err instanceof Error ? err.message : err);
      }
      // Fallback to synced data
      if (member.agents.length > 0) {
        return { machine_id: member.machine_id, agents: member.agents.map((id) => ({ id })) };
      }
      return null;
    });

    const remoteResults = await Promise.all(fetches);
    for (const r of remoteResults) {
      if (r) result.push(r);
    }

    // Add Edge members (no HTTP endpoint, use synced data)
    for (const member of clusterMgr.getMembers()) {
      if (member.machine_id === selfId) continue;
      if (member.type === 'edge' && member.agents.length > 0) {
        result.push({
          machine_id: member.machine_id,
          agents: member.agents.map((id) => ({ id })),
        });
      }
    }

    return c.json(result);
  };
}
