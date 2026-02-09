import type { Context } from 'hono';
import type { Adapter } from '../adapters/types.js';

export function testMessagesHandler(adapters: Adapter[]) {
  return async (c: Context) => {
    const agentId = c.req.query('agent_id');
    if (!agentId) return c.json({ error: 'agent_id required' }, 400);

    for (const adapter of adapters) {
      if ('getMessages' in adapter && typeof (adapter as any).getMessages === 'function') {
        const messages = (adapter as any).getMessages(agentId);
        return c.json({ agent_id: agentId, messages });
      }
    }
    return c.json({ agent_id: agentId, messages: [] });
  };
}
