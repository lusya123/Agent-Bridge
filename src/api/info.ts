import type { Context } from 'hono';
import os from 'node:os';
import type { BridgeConfig } from '../config.js';
import type { Adapter } from '../adapters/types.js';

export function infoHandler(config: BridgeConfig, adapters: Adapter[]) {
  return async (c: Context) => {
    let runningAgents = 0;
    const persistentAgents = [];

    for (const adapter of adapters) {
      const agents = await adapter.listAgents();
      runningAgents += agents.length;
      for (const a of agents) {
        if (a.persistent) {
          persistentAgents.push({
            id: a.id,
            type: a.type,
            status: a.status,
            description: a.description,
          });
        }
      }
    }

    return c.json({
      machine_id: config.machine_id,
      capabilities: config.capabilities,
      resources: {
        cpu_cores: os.cpus().length,
        memory_gb: Math.round(os.totalmem() / 1024 / 1024 / 1024),
        running_agents: runningAgents,
        max_agents: config.max_agents,
      },
      persistent_agents: persistentAgents,
    });
  };
}
