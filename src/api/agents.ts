import type { Context } from 'hono';
import type { Adapter } from '../adapters/types.js';
import { log } from '../logger.js';

export function agentsHandler(adapters: Adapter[]) {
  return async (c: Context) => {
    log.debug('API', 'GET /agents');
    const allAgents = [];
    for (const adapter of adapters) {
      const agents = await adapter.listAgents();
      allAgents.push(...agents);
    }
    return c.json(allAgents);
  };
}
