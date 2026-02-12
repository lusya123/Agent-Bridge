import { log } from './logger.js';

export interface ClusterMember {
  machine_id: string;
  type: 'hub' | 'edge';
  bridge_url?: string;       // Hub nodes: public HTTP address
  connected_hub?: string;    // Edge nodes: which Hub they're connected to
  capabilities: string[];
  agents: string[];
  last_seen: number;
}

export class ClusterManager {
  private members = new Map<string, ClusterMember>();
  private selfId: string;
  private secret: string | null = null;
  private hubHeartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(selfId: string) {
    this.selfId = selfId;
  }

  setSecret(secret: string): void {
    this.secret = secret;
  }

  getSecret(): string | null {
    return this.secret;
  }

  getSelfId(): string {
    return this.selfId;
  }

  /** Add or update a cluster member */
  addMember(member: ClusterMember): void {
    this.members.set(member.machine_id, { ...member, last_seen: Date.now() });
    log.info('Cluster', `Member joined: ${member.machine_id} (${member.type})`);
  }

  /** Remove a member from the cluster */
  removeMember(machineId: string): void {
    if (this.members.delete(machineId)) {
      log.info('Cluster', `Member left: ${machineId}`);
    }
  }

  /** Get a specific member */
  getMember(machineId: string): ClusterMember | undefined {
    return this.members.get(machineId);
  }

  /** Get all members */
  getMembers(): ClusterMember[] {
    return Array.from(this.members.values());
  }

  /** Get all Hub members (for Edge failover) */
  getHubs(): ClusterMember[] {
    return this.getMembers().filter((m) => m.type === 'hub');
  }

  /** Update last_seen timestamp */
  touch(machineId: string): void {
    const m = this.members.get(machineId);
    if (m) m.last_seen = Date.now();
  }

  /** Update agent list for a member */
  updateAgents(machineId: string, agents: string[]): void {
    const m = this.members.get(machineId);
    if (m) m.agents = agents;
  }

  /** Start Hub→Hub heartbeat (HTTP GET /health every 60s) */
  startHubHeartbeat(hubMember: ClusterMember): void {
    if (!hubMember.bridge_url || hubMember.machine_id === this.selfId) return;
    if (this.hubHeartbeatTimers.has(hubMember.machine_id)) return;

    const timer = setInterval(async () => {
      try {
        const headers: Record<string, string> = {};
        if (this.secret) headers['Authorization'] = `Bearer ${this.secret}`;
        const res = await fetch(`${hubMember.bridge_url}/health`, { headers, signal: AbortSignal.timeout(10000) });
        if (res.ok) {
          this.touch(hubMember.machine_id);
        } else {
          log.warn('Cluster', `Hub heartbeat failed for ${hubMember.machine_id}: ${res.status}`);
        }
      } catch (err) {
        log.warn('Cluster', `Hub heartbeat error for ${hubMember.machine_id}:`,
          err instanceof Error ? err.message : err);
      }
    }, 60_000);

    this.hubHeartbeatTimers.set(hubMember.machine_id, timer);
  }

  /** Stop heartbeat for a specific hub */
  stopHubHeartbeat(machineId: string): void {
    const timer = this.hubHeartbeatTimers.get(machineId);
    if (timer) {
      clearInterval(timer);
      this.hubHeartbeatTimers.delete(machineId);
    }
  }

  /** Stop all heartbeats */
  stopAllHeartbeats(): void {
    for (const timer of this.hubHeartbeatTimers.values()) {
      clearInterval(timer);
    }
    this.hubHeartbeatTimers.clear();
  }

  /** Convert to legacy ClusterConfig format for backward compat with Router */
  toLegacyCluster(): { machines: Array<{ id: string; bridge: string; role: string }> } {
    const machines = this.getHubs()
      .filter((m) => m.bridge_url && m.machine_id !== this.selfId)
      .map((m) => ({
        id: m.machine_id,
        bridge: m.bridge_url!,
        role: 'worker',
      }));
    return { machines };
  }
}
