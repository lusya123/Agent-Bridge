import { describe, it, expect, vi, afterEach } from 'vitest';
import { Router } from '../src/router.js';
import {
  createMockAdapter,
  createBridgeConfig,
  createClusterConfig,
} from './helpers.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Router', () => {
  it('delivers message to local adapter when it has the agent', async () => {
    const adapter = createMockAdapter({
      agents: [
        { id: 'a1', type: 'openclaw', status: 'running', persistent: false },
      ],
    });
    const config = createBridgeConfig();
    const cluster = createClusterConfig();
    const router = new Router(config, cluster, [adapter]);

    await router.deliver('a1', 'sender', 'hello world');

    expect(adapter.sendMessage).toHaveBeenCalledWith(
      'a1',
      'sender',
      'hello world',
    );
  });

  it('tries first adapter then second when first does not have agent', async () => {
    const adapter1 = createMockAdapter({ agents: [] });
    const adapter2 = createMockAdapter({
      agents: [
        { id: 'a2', type: 'claude-code', status: 'idle', persistent: false },
      ],
    });
    const config = createBridgeConfig();
    const cluster = createClusterConfig();
    const router = new Router(config, cluster, [adapter1, adapter2]);

    await router.deliver('a2', 'sender', 'msg');

    expect(adapter1.sendMessage).not.toHaveBeenCalled();
    expect(adapter2.sendMessage).toHaveBeenCalledWith('a2', 'sender', 'msg');
  });

  it('throws when agent is not found anywhere', async () => {
    const adapter = createMockAdapter({ agents: [] });
    const config = createBridgeConfig();
    const cluster = createClusterConfig();
    const router = new Router(config, cluster, [adapter]);

    await expect(
      router.deliver('nonexistent', 'sender', 'msg'),
    ).rejects.toThrow(/not found in cluster/);
  });

  it('throws when no adapters and no cluster machines', async () => {
    const config = createBridgeConfig();
    const cluster = createClusterConfig();
    const router = new Router(config, cluster, []);

    await expect(
      router.deliver('any-agent', 'sender', 'msg'),
    ).rejects.toThrow(/not found in cluster/);
  });

  it('forwards directly to remote when targetMachine is specified', async () => {
    const adapter = createMockAdapter({
      agents: [
        { id: 'a1', type: 'openclaw', status: 'running', persistent: false },
      ],
    });
    const config = createBridgeConfig({ machine_id: 'local' });
    const cluster = createClusterConfig([
      { id: 'remote-1', bridge: 'http://remote-1:9100', role: 'worker' },
    ]);
    const router = new Router(config, cluster, [adapter]);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await router.deliver('a1', 'sender', 'hello', 'remote-1');

    // Should NOT check local adapter
    expect(adapter.sendMessage).not.toHaveBeenCalled();
    // Should forward to remote
    expect(fetch).toHaveBeenCalledWith('http://remote-1:9100/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: 'a1', from: 'sender', message: 'hello' }),
    });
  });

  it('throws MACHINE_NOT_FOUND when targetMachine does not exist', async () => {
    const config = createBridgeConfig({ machine_id: 'local' });
    const cluster = createClusterConfig([
      { id: 'remote-1', bridge: 'http://remote-1:9100', role: 'worker' },
    ]);
    const router = new Router(config, cluster, []);

    await expect(
      router.deliver('a1', 'sender', 'msg', 'nonexistent'),
    ).rejects.toThrow(/Machine "nonexistent" not found in cluster/);
  });

  it('falls through to local lookup when targetMachine is self', async () => {
    const adapter = createMockAdapter({
      agents: [
        { id: 'a1', type: 'openclaw', status: 'running', persistent: false },
      ],
    });
    const config = createBridgeConfig({ machine_id: 'local' });
    const cluster = createClusterConfig();
    const router = new Router(config, cluster, [adapter]);

    await router.deliver('a1', 'sender', 'hello', 'local');

    expect(adapter.sendMessage).toHaveBeenCalledWith('a1', 'sender', 'hello');
  });

  it('forwarded body does not contain machine field (prevents loops)', async () => {
    const config = createBridgeConfig({ machine_id: 'local' });
    const cluster = createClusterConfig([
      { id: 'remote-1', bridge: 'http://remote-1:9100', role: 'worker' },
    ]);
    const router = new Router(config, cluster, []);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await router.deliver('a1', 'sender', 'hello', 'remote-1');

    const callBody = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(callBody).not.toHaveProperty('machine');
  });

  it('throws 502 when remote machine returns error on targeted delivery', async () => {
    const config = createBridgeConfig({ machine_id: 'local' });
    const cluster = createClusterConfig([
      { id: 'remote-1', bridge: 'http://remote-1:9100', role: 'worker' },
    ]);
    const router = new Router(config, cluster, []);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error_code: 'INTERNAL_ERROR', error: 'boom' }),
    } as Response);

    await expect(
      router.deliver('a1', 'sender', 'msg', 'remote-1'),
    ).rejects.toThrow(/Failed to deliver message to "a1" on remote-1/);
  });
});
