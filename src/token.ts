import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const TOKEN_DIR = join(homedir(), '.agent-bridge');
const TOKEN_FILE = join(TOKEN_DIR, 'token');
const PREFIX = 'ab_';

export interface ParsedToken {
  secret: string;
  hubAddress: string;
}

/** Generate a 128-bit random secret with ab_ prefix */
export function generateSecret(): string {
  return PREFIX + randomBytes(16).toString('base64url');
}

/** Build a full token string: <secret>@<hub_address> */
export function buildToken(secret: string, hubAddress: string): string {
  return `${secret}@${hubAddress}`;
}

/** Parse token string into secret + hub address */
export function parseToken(token: string): ParsedToken {
  const atIdx = token.indexOf('@');
  if (atIdx === -1) {
    throw new Error(`Invalid token format (missing @): ${token}`);
  }
  const secret = token.slice(0, atIdx);
  const hubAddress = token.slice(atIdx + 1);
  if (!secret || !hubAddress) {
    throw new Error(`Invalid token format: ${token}`);
  }
  return { secret, hubAddress };
}

/** Save token to ~/.agent-bridge/token */
export function persistToken(token: string): void {
  if (!existsSync(TOKEN_DIR)) {
    mkdirSync(TOKEN_DIR, { recursive: true });
  }
  writeFileSync(TOKEN_FILE, token, 'utf-8');
}

/** Load token from ~/.agent-bridge/token, returns null if not found */
export function loadPersistedToken(): string | null {
  if (!existsSync(TOKEN_FILE)) return null;
  const content = readFileSync(TOKEN_FILE, 'utf-8').trim();
  return content || null;
}
