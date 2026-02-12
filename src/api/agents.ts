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

    // Add agents from other cluster members (from synced info)
    for (const member of clusterMgr.getMembers()) {
      if (member.machine_id === selfId) continue;
      if (member.agents.length > 0) {
        result.push({
          machine_id: member.machine_id,
          agents: member.agents.map((id) => ({ id })),
        });
      }
    }

    return c.json(result);
  };
}
