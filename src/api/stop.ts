import type { Context } from 'hono';
import type { Adapter } from '../adapters/types.js';
import type { HeartbeatManager } from '../heartbeat.js';
import { log } from '../logger.js';

export function stopHandler(adapters: Adapter[], heartbeatManager?: HeartbeatManager) {
  return async (c: Context) => {
    const body = await c.req.json<{ agent_id?: string }>();
    log.debug('API', `POST /stop agent_id=${body.agent_id}`);

    if (!body.agent_id) {
      return c.json({ error: 'agent_id is required' }, 400);
    }

    for (const adapter of adapters) {
      if (await adapter.hasAgent(body.agent_id)) {
        if (!adapter.stopAgent) {
          return c.json({ error: `Adapter "${adapter.type}" does not support stop` }, 400);
        }
        try {
          await adapter.stopAgent(body.agent_id);
          heartbeatManager?.remove(body.agent_id);
          return c.json({ ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          return c.json({ error: msg }, 500);
        }
      }
    }

    return c.json({ error: `Agent "${body.agent_id}" not found` }, 404);
  };
}
