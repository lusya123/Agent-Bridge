import { vi } from 'vitest';
import type { Adapter, AgentInfo } from '../src/adapters/types.js';

/**
 * Creates a mock adapter that implements the Adapter interface.
 * All methods are vi.fn() stubs with sensible defaults.
 */
export function createMockAdapter(
  overrides: {
    type?: Adapter['type'];
    agents?: AgentInfo[];
  } = {},
): Adapter {
  const type = overrides.type ?? 'generic';
  const agents = overrides.agents ?? [];

  return {
    type,
    sendMessage: vi.fn(async () => {}),
    listAgents: vi.fn(async () => agents),
    hasAgent: vi.fn(async (id: string) => agents.some((a) => a.id === id)),
  };
}

/**
 * Creates a sample BridgeConfig for testing.
 */
export function createBridgeConfig(overrides: Record<string, unknown> = {}) {
  return {
    machine_id: 'test-machine',
    port: 9100,
    capabilities: ['openclaw'] as ('openclaw' | 'claude-code')[],
    max_agents: 5,
    persistent_agents: [],
    adapters: {},
    ...overrides,
  };
}

/**
 * Creates a sample ClusterConfig for testing.
 */
export function createClusterConfig(
  machines: Array<{ id: string; bridge: string; role: string }> = [],
) {
  return { machines };
}
