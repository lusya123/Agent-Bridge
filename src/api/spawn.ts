import type { Context } from 'hono';

export function spawnHandler() {
  return async (c: Context) => {
    return c.json({ error: 'Not implemented (Phase 3)' }, 501);
  };
}
