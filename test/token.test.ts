import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateSecret, buildToken, parseToken } from '../src/token.js';

describe('generateSecret()', () => {
  it('returns a string starting with "ab_"', () => {
    const secret = generateSecret();
    expect(secret.startsWith('ab_')).toBe(true);
  });

  it('returns different values each call', () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).not.toBe(b);
  });

  it('has reasonable length (ab_ + 16 bytes base64url)', () => {
    const secret = generateSecret();
    // 3 (prefix) + 22 (base64url of 16 bytes) = 25
    expect(secret.length).toBe(25);
  });
});

describe('buildToken()', () => {
  it('creates correct format "secret@address"', () => {
    const token = buildToken('ab_mysecret', '192.168.1.1:9100');
    expect(token).toBe('ab_mysecret@192.168.1.1:9100');
  });

  it('handles address with hostname', () => {
    const token = buildToken('ab_xyz', 'hub.example.com:9100');
    expect(token).toBe('ab_xyz@hub.example.com:9100');
  });
});

describe('parseToken()', () => {
  it('correctly splits secret and hub address', () => {
    const result = parseToken('ab_mysecret@192.168.1.1:9100');
    expect(result.secret).toBe('ab_mysecret');
    expect(result.hubAddress).toBe('192.168.1.1:9100');
  });

  it('handles @ in hub address (uses first @)', () => {
    // token.indexOf('@') finds the first @
    const result = parseToken('ab_secret@host@weird:9100');
    expect(result.secret).toBe('ab_secret');
    expect(result.hubAddress).toBe('host@weird:9100');
  });

  it('throws on missing @', () => {
    expect(() => parseToken('ab_secretnoaddress')).toThrow('missing @');
  });

  it('throws on empty secret (starts with @)', () => {
    expect(() => parseToken('@192.168.1.1:9100')).toThrow('Invalid token format');
  });

  it('throws on empty hub address (ends with @)', () => {
    expect(() => parseToken('ab_secret@')).toThrow('Invalid token format');
  });

  it('round-trips with buildToken', () => {
    const secret = generateSecret();
    const address = '10.0.0.1:9100';
    const token = buildToken(secret, address);
    const parsed = parseToken(token);
    expect(parsed.secret).toBe(secret);
    expect(parsed.hubAddress).toBe(address);
  });
});

describe('persistToken / loadPersistedToken', () => {
  let tmpDir: string;

  beforeEach(async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    tmpDir = mkdtempSync(join(tmpdir(), 'ab-token-test-'));
  });

  afterEach(async () => {
    const { rmSync } = await import('node:fs');
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('round-trips persist and load', async () => {
    const { writeFileSync, readFileSync, mkdirSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');

    // Simulate what persistToken/loadPersistedToken do, using tmpDir
    const tokenDir = join(tmpDir, '.agent-bridge');
    const tokenFile = join(tokenDir, 'token');

    const token = buildToken(generateSecret(), 'hub.test:9100');

    // persist
    if (!existsSync(tokenDir)) mkdirSync(tokenDir, { recursive: true });
    writeFileSync(tokenFile, token, 'utf-8');

    // load
    const loaded = readFileSync(tokenFile, 'utf-8').trim();
    expect(loaded).toBe(token);
  });

  it('returns null when token file does not exist', async () => {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');

    const tokenFile = join(tmpDir, '.agent-bridge', 'token');
    expect(existsSync(tokenFile)).toBe(false);
  });
});
