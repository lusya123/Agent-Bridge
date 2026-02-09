import type { Adapter } from './adapters/types.js';
import type { BridgeConfig, ClusterConfig } from './config.js';

export class Router {
  constructor(
    private config: BridgeConfig,
    private cluster: ClusterConfig,
    private adapters: Adapter[],
  ) {}

  async deliver(agentId: string, from: string, message: string): Promise<void> {
    // try local adapters first
    for (const adapter of this.adapters) {
      if (await adapter.hasAgent(agentId)) {
        await adapter.sendMessage(agentId, from, message);
        return;
      }
    }

    // locate on remote machines
    const others = this.cluster.machines.filter(
      (m) => m.id !== this.config.machine_id,
    );

    for (const machine of others) {
      try {
        const locateRes = await fetch(`${machine.bridge}/agents`);
        if (!locateRes.ok) continue;
        const agents = (await locateRes.json()) as Array<{ id: string }>;
        if (!agents.some((a) => a.id === agentId)) continue;

        // forward to remote bridge
        const res = await fetch(`${machine.bridge}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: agentId, from, message }),
        });
        if (!res.ok) {
          throw new Error(`Remote bridge ${machine.id} returned ${res.status}`);
        }
        return;
      } catch {
        continue;
      }
    }

    throw new Error(`Agent "${agentId}" not found in cluster`);
  }
}
