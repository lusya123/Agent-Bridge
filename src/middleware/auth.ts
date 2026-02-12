import type { Context, Next } from 'hono';

/**
 * Creates a Hono middleware that validates Authorization: Bearer <secret>.
 * If secret is null/undefined, auth is disabled (standalone mode).
 */
export function authMiddleware(getSecret: () => string | null) {
  return async (c: Context, next: Next) => {
    const secret = getSecret();
    // No secret configured → standalone mode, skip auth
    if (!secret) return next();

    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ error_code: 'AUTH_REQUIRED', error: 'Missing Authorization header' }, 401);
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer' || parts[1] !== secret) {
      return c.json({ error_code: 'AUTH_FAILED', error: 'Invalid secret' }, 401);
    }

    return next();
  };
}
