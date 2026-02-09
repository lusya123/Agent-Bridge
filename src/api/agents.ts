import type { Context } from 'hono';
import type { Adapter } from '../adapters/types.js';

export function agentsHandler(adapters: Adapter[]) {
  return async (c: Context) => {
    const allAgents = [];
    for (const adapter of adapters) {
      const agents = await adapter.listAgents();
      allAgents.push(...agents);
    }
    return c.json(allAgents);
  };
}
