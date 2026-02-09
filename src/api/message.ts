import type { Context } from 'hono';
import type { Router } from '../router.js';
import {
  BridgeError,
  ErrorCode,
  errorResponse,
  getErrorDetail,
} from '../errors.js';
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
      return c.json(errorResponse(
        ErrorCode.MISSING_FIELDS,
        'agent_id and message are required',
      ), 400);
    }

    const from = body.from || 'anonymous';

    try {
      await router.deliver(body.agent_id, from, body.message);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof BridgeError) {
        return c.json(
          errorResponse(err.errorCode, err.message, err.detail),
          err.status as 400,
        );
      }
      return c.json(errorResponse(
        ErrorCode.AGENT_NOT_FOUND,
        `Agent "${body.agent_id}" not found`,
        getErrorDetail(err),
      ), 404);
    }
  };
}
