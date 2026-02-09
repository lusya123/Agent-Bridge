import { describe, it, expect, vi } from 'vitest';
import { Router } from '../src/router.js';
import {
  createMockAdapter,
  createBridgeConfig,
  createClusterConfig,
} from './helpers.js';

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
});
