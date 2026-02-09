import type { Context } from 'hono';
import type { Router } from '../router.js';
import { log } from '../logger.js';

export function messageHandler(router: Router) {
  return async (c: Context) => {
    const body = await c.req.json<{
      agent_id?: string;
      from?: string;
      message?: string;
    }>();
    log.debug('API', `POST /message agent_id=${body.agent_id}`);

    if (!body.agent_id || !body.message) {
      return c.json({ error: 'agent_id and message are required' }, 400);
    }

    const from = body.from || 'anonymous';

    try {
      await router.deliver(body.agent_id, from, body.message);
      return c.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: msg }, 404);
    }
  };
}
