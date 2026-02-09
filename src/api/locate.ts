import type { Context } from 'hono';
import type { Adapter } from '../adapters/types.js';
import type { BridgeConfig, ClusterConfig } from '../config.js';
import { ErrorCode, errorResponse, getErrorDetail } from '../errors.js';
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
      return c.json(errorResponse(
        ErrorCode.MISSING_AGENT_ID,
        'agent_id is required',
      ), 400);
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

    const results = await Promise.all(
      others.map(async (m) => {
        try {
          const res = await fetch(`${m.bridge}/agents`);
          if (!res.ok) {
            return {
              status: 'error' as const,
              detail: `${m.id}: /agents returned ${res.status}`,
            };
          }
          const agents = (await res.json()) as Array<{
            id: string; type: string;
          }>;
          const found = agents.find((a) => a.id === agentId);
          if (!found) return { status: 'miss' as const };
          return {
            status: 'found' as const,
            machine: m,
            type: found.type,
          };
        } catch (err) {
          return {
            status: 'error' as const,
            detail: `${m.id}: ${getErrorDetail(err)}`,
          };
        }
      }),
    );

    for (const r of results) {
      if (r.status === 'found') {
        return c.json({
          agent_id: agentId,
          machine: r.machine.id,
          bridge: r.machine.bridge,
          type: r.type,
        });
      }
    }

    const remoteErrors = results
      .filter((r) => r.status === 'error')
      .map((r) => r.detail);
    if (remoteErrors.length > 0) {
      return c.json(errorResponse(
        ErrorCode.REMOTE_UNREACHABLE,
        `Failed to fully query cluster for agent "${agentId}"`,
        remoteErrors.join('; '),
      ), 502);
    }

    return c.json(errorResponse(
      ErrorCode.AGENT_NOT_FOUND,
      `Agent "${agentId}" not found`,
    ), 404);
  };
}
