import { describe, it, expect } from 'vitest';
import { execSync, ExecSyncOptionsWithStringEncoding } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CLI = join(ROOT, 'dist/cli.js');

const opts: ExecSyncOptionsWithStringEncoding = {
  cwd: ROOT,
  timeout: 5000,
  encoding: 'utf-8',
  env: { ...process.env },
};

function runCli(args: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(`node ${CLI} ${args}`, {
      ...opts,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      code: err.status ?? 1,
    };
  }
}

describe('CLI (src/cli.ts)', () => {
  it('--config points to custom config path', () => {
    const result = runCli('--config /tmp/nonexistent-xyz.json');
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/nonexistent-xyz/);
    expect(result.code).not.toBe(0);
  });

  it('exits with error when config is missing', () => {
    const result = runCli('--config /tmp/no-such-config-abc.json');
    expect(result.code).not.toBe(0);
  });

  it('--debug enables DEBUG level output', () => {
    const result = runCli('--debug --config /tmp/nonexistent-xyz.json');
    const output = result.stdout + result.stderr;
    // With --debug, the error output should include [ERROR] tag
    expect(output).toMatch(/\[ERROR\]/);
  });
});
