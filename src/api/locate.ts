import type { Context } from 'hono';
import type { Adapter } from '../adapters/types.js';
import type { BridgeConfig, ClusterConfig } from '../config.js';
import { ErrorCode } from '../errors.js';
import { log } from '../logger.js';

export function locateHandler(
  config: BridgeConfig,
  cluster: ClusterConfig,
  adapters: Adapter[],
) {
  return async (c: Context) => {
    const agentId = c.req.query('agent_id');
    log.debug('API', `GET /locate agent_id=${agentId}`);
    if (!agentId) {
      return c.json({
        error_code: ErrorCode.MISSING_AGENT_ID,
        error: 'agent_id is required',
      }, 400);
    }

    // check local adapters first
    for (const adapter of adapters) {
      if (await adapter.hasAgent(agentId)) {
        const agents = await adapter.listAgents();
        const agent = agents.find((a) => a.id === agentId);
        return c.json({
          agent_id: agentId,
          machine: config.machine_id,
          bridge: `http://127.0.0.1:${config.port}`,
          type: agent?.type ?? adapter.type,
        });
      }
    }

    // query remote machines in parallel
    const others = cluster.machines.filter(
      (m) => m.id !== config.machine_id,
    );

    const results = await Promise.allSettled(
      others.map(async (m) => {
        const res = await fetch(`${m.bridge}/agents`);
        if (!res.ok) return null;
        const agents = (await res.json()) as Array<{
          id: string; type: string;
        }>;
        const found = agents.find((a) => a.id === agentId);
        return found ? { machine: m, type: found.type } : null;
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        return c.json({
          agent_id: agentId,
          machine: r.value.machine.id,
          bridge: r.value.machine.bridge,
          type: r.value.type,
        });
      }
    }

    return c.json({
      error_code: ErrorCode.AGENT_NOT_FOUND,
      error: `Agent "${agentId}" not found`,
    }, 404);
  };
}
