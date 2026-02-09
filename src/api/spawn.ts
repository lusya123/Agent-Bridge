import type { Context } from 'hono';
import type { Adapter, SpawnOptions } from '../adapters/types.js';
import type { BridgeConfig, ClusterConfig } from '../config.js';

export function spawnHandler(
  config: BridgeConfig,
  cluster: ClusterConfig,
  adapters: Adapter[],
) {
  return async (c: Context) => {
    const body = await c.req.json<Partial<SpawnOptions>>();

    if (!body.type || !body.task) {
      return c.json({ error: 'type and task are required' }, 400);
    }

    const targetMachine = body.machine || config.machine_id;

    // remote spawn: forward to target machine's Bridge
    if (targetMachine !== config.machine_id && targetMachine !== 'auto') {
      const machine = cluster.machines.find((m) => m.id === targetMachine);
      if (!machine) {
        return c.json({ error: `Machine "${targetMachine}" not found` }, 404);
      }
      try {
        const res = await fetch(`${machine.bridge}/spawn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, machine: machine.id }),
        });
        const result = await res.json();
        return c.json(result, res.status as 200);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return c.json({ error: `Failed to reach ${targetMachine}: ${msg}` }, 502);
      }
    }

    // local spawn: find matching adapter
    const adapter = adapters.find((a) => a.type === body.type);
    if (!adapter || !adapter.spawnAgent) {
      return c.json({ error: `No adapter for type "${body.type}"` }, 400);
    }

    try {
      const agentId = await adapter.spawnAgent(body as SpawnOptions);
      return c.json({ ok: true, agent_id: agentId, machine: config.machine_id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: msg }, 500);
    }
  };
}
