import type { Adapter } from './adapters/types.js';
import type { BridgeConfig, ClusterConfig } from './config.js';
import { BridgeError, ErrorCode, getErrorDetail } from './errors.js';
import { log } from './logger.js';

export class Router {
  constructor(
    private config: BridgeConfig,
    private cluster: ClusterConfig,
    private adapters: Adapter[],
  ) {}

  async deliver(agentId: string, from: string, message: string): Promise<void> {
    log.debug('Router', `Delivering message to ${agentId} from ${from}`);
    // try local adapters first
    for (const adapter of this.adapters) {
      if (await adapter.hasAgent(agentId)) {
        log.debug('Router', `Found ${agentId} on local adapter ${adapter.type}`);
        await adapter.sendMessage(agentId, from, message);
        return;
      }
    }

    // locate on remote machines
    const others = this.cluster.machines.filter(
      (m) => m.id !== this.config.machine_id,
    );
    const remoteErrors: string[] = [];

    for (const machine of others) {
      try {
        const locateRes = await fetch(`${machine.bridge}/agents`);
        if (!locateRes.ok) {
          remoteErrors.push(`${machine.id}: /agents returned ${locateRes.status}`);
          continue;
        }
        const agents = (await locateRes.json()) as Array<{ id: string }>;
        if (!agents.some((a) => a.id === agentId)) continue;

        // forward to remote bridge
        const res = await fetch(`${machine.bridge}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: agentId, from, message }),
        });
        if (!res.ok) {
          let remoteDetail = `${machine.id}: /message returned ${res.status}`;
          try {
            const data = await res.json() as {
              error?: string;
              error_code?: string;
              detail?: string;
            };
            const pieces = [data.error_code, data.error, data.detail].filter(Boolean);
            if (pieces.length > 0) {
              remoteDetail = `${remoteDetail} (${pieces.join(' | ')})`;
            }
          } catch {
            // keep status-only detail if response is not JSON
          }
          throw new BridgeError({
            status: 502,
            errorCode: ErrorCode.REMOTE_UNREACHABLE,
            message: `Failed to deliver message to "${agentId}"`,
            detail: remoteDetail,
          });
        }
        return;
      } catch (err) {
        if (err instanceof BridgeError) throw err;
        remoteErrors.push(`${machine.id}: ${getErrorDetail(err)}`);
        continue;
      }
    }

    if (remoteErrors.length > 0) {
      throw new BridgeError({
        status: 502,
        errorCode: ErrorCode.REMOTE_UNREACHABLE,
        message: `Failed to fully query cluster for agent "${agentId}"`,
        detail: remoteErrors.join('; '),
      });
    }

    throw new BridgeError({
      status: 404,
      errorCode: ErrorCode.AGENT_NOT_FOUND,
      message: `Agent "${agentId}" not found in cluster`,
    });
  }
}
