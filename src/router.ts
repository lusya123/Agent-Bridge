import type { Adapter } from './adapters/types.js';
import type { BridgeConfig, ClusterConfig } from './config.js';
import type { ClusterManager } from './cluster.js';
import type { ClusterWsServer } from './cluster-ws.js';
import { BridgeError, ErrorCode, getErrorDetail } from './errors.js';
import { log } from './logger.js';

export class Router {
  private wsServer: ClusterWsServer | null = null;

  constructor(
    private config: BridgeConfig,
    private cluster: ClusterConfig,
    private adapters: Adapter[],
    private clusterMgr?: ClusterManager,
  ) {}

  /** Set the WebSocket server for Edge relay */
  setWsServer(server: ClusterWsServer): void {
    this.wsServer = server;
  }

  /** Build headers with auth if secret is available */
  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    const secret = this.clusterMgr?.getSecret();
    if (secret) headers['Authorization'] = `Bearer ${secret}`;
    return headers;
  }

  async deliver(agentId: string, from: string, message: string, targetMachine?: string): Promise<void> {
    log.debug('Router', `Delivering message to ${agentId} from ${from}` +
      (targetMachine ? ` (target: ${targetMachine})` : ''));

    // If targetMachine is specified and not this machine, forward directly
    if (targetMachine && targetMachine !== this.config.machine_id) {
      // Check if target is an Edge node connected to this Hub
      if (this.tryRelayToEdge(targetMachine, '/message', { agent_id: agentId, from, message })) {
        log.debug('Router', `Relayed message to Edge ${targetMachine} via WebSocket`);
        return;
      }

      const machine = this.cluster.machines.find((m) => m.id === targetMachine);
      if (!machine) {
        throw new BridgeError({
          status: 404,
          errorCode: ErrorCode.MACHINE_NOT_FOUND,
          message: `Machine "${targetMachine}" not found in cluster`,
        });
      }
      const res = await fetch(`${machine.bridge}/message`, {
        method: 'POST',
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
        // Forward without machine field to prevent loops
        body: JSON.stringify({ agent_id: agentId, from, message }),
      });
      if (!res.ok) {
        let remoteDetail = `${machine.id}: /message returned ${res.status}`;
        try {
          const data = await res.json() as { error_code?: string; error?: string; detail?: string };
          const pieces = [data.error_code, data.error, data.detail].filter(Boolean);
          if (pieces.length > 0) remoteDetail = `${remoteDetail} (${pieces.join(' | ')})`;
        } catch { /* keep status-only detail */ }
        throw new BridgeError({
          status: 502,
          errorCode: ErrorCode.REMOTE_UNREACHABLE,
          message: `Failed to deliver message to "${agentId}" on ${targetMachine}`,
          detail: remoteDetail,
        });
      }
      return;
    }

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
        const locateRes = await fetch(`${machine.bridge}/agents`, {
          headers: this.authHeaders(),
        });
        if (!locateRes.ok) {
          remoteErrors.push(`${machine.id}: /agents returned ${locateRes.status}`);
          continue;
        }
        const agents = (await locateRes.json()) as Array<{ id: string }>;
        if (!agents.some((a) => a.id === agentId)) continue;

        // forward to remote bridge
        const res = await fetch(`${machine.bridge}/message`, {
          method: 'POST',
          headers: this.authHeaders({ 'Content-Type': 'application/json' }),
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

  /** Try to relay a message to an Edge node via WebSocket. Returns true if relayed. */
  private tryRelayToEdge(machineId: string, path: string, body: Record<string, unknown>): boolean {
    if (!this.wsServer || !this.clusterMgr) return false;
    const member = this.clusterMgr.getMember(machineId);
    if (!member || member.type !== 'edge') return false;
    return this.wsServer.relayToEdge(machineId, path, body);
  }
}
