import WebSocket, { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { ClusterManager, ClusterMember } from './cluster.js';
import { log } from './logger.js';

// --- Message types for cluster WebSocket protocol ---

export interface JoinMessage {
  type: 'join';
  secret: string;
  machine_id: string;
  capabilities: string[];
}

export interface WelcomeMessage {
  type: 'welcome';
  members: ClusterMember[];
  hub_id: string;
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export interface RelayMessage {
  type: 'relay';
  payload: {
    path: string;
    body: Record<string, unknown>;
  };
}

export interface PingMessage { type: 'ping'; }
export interface PongMessage { type: 'pong'; }

export interface MemberJoinedMessage {
  type: 'member_joined';
  member: ClusterMember;
}

export interface MemberLeftMessage {
  type: 'member_left';
  machine_id: string;
}

export interface AgentsSyncMessage {
  type: 'agents_sync';
  machine_id: string;
  agents: string[];
}

export type ClusterWsMessage =
  | JoinMessage | WelcomeMessage | ErrorMessage
  | RelayMessage | PingMessage | PongMessage
  | MemberJoinedMessage | MemberLeftMessage | AgentsSyncMessage;

// ============================================================
// Hub-side: WebSocket server accepting Edge connections
// ============================================================

export class ClusterWsServer {
  private wss: WebSocketServer | null = null;
  /** Map of machine_id → WebSocket connection for connected Edge nodes */
  private edgeConnections = new Map<string, WebSocket>();

  constructor(private cluster: ClusterManager) {}

  /** Attach to an existing HTTP server */
  attachToServer(server: import('node:http').Server): void {
    this.wss = new WebSocketServer({ server, path: '/cluster/ws' });

    this.wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
      let edgeMachineId: string | null = null;

      // Edge must send join within 10s
      const joinTimeout = setTimeout(() => {
        this.send(ws, { type: 'error', code: 'JOIN_TIMEOUT', message: 'Join timeout' });
        ws.close();
      }, 10_000);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as ClusterWsMessage;
          this.handleEdgeMessage(ws, msg, edgeMachineId, (id) => {
            edgeMachineId = id;
            clearTimeout(joinTimeout);
          });
        } catch {
          // ignore non-JSON
        }
      });

      ws.on('close', () => {
        clearTimeout(joinTimeout);
        if (edgeMachineId) {
          this.edgeConnections.delete(edgeMachineId);
          this.cluster.removeMember(edgeMachineId);
          log.info('ClusterWS', `Edge disconnected: ${edgeMachineId}`);
          // Broadcast member_left to other edges
          this.broadcastToEdges({ type: 'member_left', machine_id: edgeMachineId }, edgeMachineId);
        }
      });

      ws.on('error', (err) => {
        log.warn('ClusterWS', `Edge WebSocket error: ${err.message}`);
      });
    });

    log.info('ClusterWS', 'WebSocket server attached at /cluster/ws');
  }

  private handleEdgeMessage(
    ws: WebSocket,
    msg: ClusterWsMessage,
    currentId: string | null,
    setId: (id: string) => void,
  ): void {
    if (msg.type === 'join') {
      const join = msg as JoinMessage;
      const expectedSecret = this.cluster.getSecret();

      if (expectedSecret && join.secret !== expectedSecret) {
        this.send(ws, { type: 'error', code: 'AUTH_FAILED', message: 'Invalid secret' });
        ws.close();
        return;
      }

      // Register edge member
      this.cluster.addMember({
        machine_id: join.machine_id,
        type: 'edge',
        connected_hub: this.cluster.getSelfId(),
        capabilities: join.capabilities,
        agents: [],
        last_seen: Date.now(),
      });

      this.edgeConnections.set(join.machine_id, ws);
      setId(join.machine_id);

      // Send welcome with full member list
      this.send(ws, {
        type: 'welcome',
        members: this.cluster.getMembers(),
        hub_id: this.cluster.getSelfId(),
      });

      log.info('ClusterWS', `Edge joined: ${join.machine_id}`);

      // Broadcast new member to other edges
      const newMember = this.cluster.getMember(join.machine_id)!;
      this.broadcastToEdges({ type: 'member_joined', member: newMember }, join.machine_id);
      return;
    }

    if (msg.type === 'ping') {
      if (currentId) this.cluster.touch(currentId);
      this.send(ws, { type: 'pong' });
      return;
    }

    if (msg.type === 'agents_sync' && currentId) {
      const sync = msg as AgentsSyncMessage;
      this.cluster.updateAgents(currentId, sync.agents);
      log.debug('ClusterWS', `Agent sync from ${currentId}: ${sync.agents.length} agents`);
      return;
    }
  }

  /** Send a relay message to a specific Edge node */
  relayToEdge(machineId: string, path: string, body: Record<string, unknown>): boolean {
    const ws = this.edgeConnections.get(machineId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    this.send(ws, { type: 'relay', payload: { path, body } });
    return true;
  }

  /** Check if an Edge node is connected to this Hub */
  hasEdge(machineId: string): boolean {
    const ws = this.edgeConnections.get(machineId);
    return !!ws && ws.readyState === WebSocket.OPEN;
  }

  /** Broadcast a message to all connected Edge nodes (optionally excluding one) */
  broadcastToEdges(msg: ClusterWsMessage, excludeId?: string): void {
    for (const [id, ws] of this.edgeConnections) {
      if (id === excludeId) continue;
      if (ws.readyState === WebSocket.OPEN) {
        this.send(ws, msg);
      }
    }
  }

  private send(ws: WebSocket, msg: ClusterWsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.wss?.close();
    this.edgeConnections.clear();
  }
}

// ============================================================
// Edge-side: WebSocket client connecting to Hub
// ============================================================

export class ClusterWsClient {
  private ws: WebSocket | null = null;
  private hubAddresses: string[] = [];
  private currentHubIdx = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private missedPongs = 0;
  private connected = false;
  private onRelay: ((path: string, body: Record<string, unknown>) => void) | null = null;

  constructor(
    private cluster: ClusterManager,
    private machineId: string,
    private secret: string,
    private capabilities: string[],
    initialHubAddress: string,
  ) {
    this.hubAddresses = [initialHubAddress];
  }

  /** Set callback for relay messages */
  setRelayHandler(handler: (path: string, body: Record<string, unknown>) => void): void {
    this.onRelay = handler;
  }

  async connect(): Promise<void> {
    const hubAddr = this.hubAddresses[this.currentHubIdx];
    const wsUrl = hubAddr.startsWith('ws') ? hubAddr : `ws://${hubAddr}/cluster/ws`;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        log.info('ClusterWS', `Connected to Hub: ${hubAddr}`);
        this.reconnectDelay = 1000;
        // Send join
        this.send({
          type: 'join',
          secret: this.secret,
          machine_id: this.machineId,
          capabilities: this.capabilities,
        });
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as ClusterWsMessage;
          this.handleMessage(msg, resolve, reject);
        } catch {
          // ignore
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.stopPing();
        log.info('ClusterWS', 'Disconnected from Hub, scheduling reconnect...');
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        log.warn('ClusterWS', `WebSocket error: ${err.message}`);
        if (!this.connected) reject(err);
      });
    });
  }

  private handleMessage(
    msg: ClusterWsMessage,
    onWelcome?: (value: void) => void,
    onError?: (reason: Error) => void,
  ): void {
    switch (msg.type) {
      case 'welcome': {
        this.connected = true;
        // Update cluster members from welcome
        for (const m of (msg as WelcomeMessage).members) {
          if (m.machine_id !== this.machineId) {
            this.cluster.addMember(m);
          }
        }
        // Extract hub addresses for failover
        const hubs = (msg as WelcomeMessage).members
          .filter((m) => m.type === 'hub' && m.bridge_url)
          .map((m) => m.bridge_url!.replace(/^http/, 'ws'));
        if (hubs.length > 0) {
          this.hubAddresses = hubs;
          this.currentHubIdx = 0;
        }
        this.startPing();
        onWelcome?.();
        break;
      }
      case 'error': {
        const errMsg = msg as ErrorMessage;
        log.error('ClusterWS', `Hub error: ${errMsg.code} - ${errMsg.message}`);
        onError?.(new Error(`Hub error: ${errMsg.code}`));
        break;
      }
      case 'relay': {
        const relay = msg as RelayMessage;
        log.debug('ClusterWS', `Relay received: ${relay.payload.path}`);
        this.onRelay?.(relay.payload.path, relay.payload.body);
        break;
      }
      case 'pong': {
        this.missedPongs = 0;
        break;
      }
      case 'member_joined': {
        const joined = msg as MemberJoinedMessage;
        this.cluster.addMember(joined.member);
        break;
      }
      case 'member_left': {
        const left = msg as MemberLeftMessage;
        this.cluster.removeMember(left.machine_id);
        break;
      }
    }
  }

  private startPing(): void {
    this.stopPing();
    this.missedPongs = 0;
    this.pingTimer = setInterval(() => {
      if (this.missedPongs >= 3) {
        log.warn('ClusterWS', 'Missed 3 pongs, reconnecting...');
        this.ws?.close();
        return;
      }
      this.missedPongs++;
      this.send({ type: 'ping' });
    }, 30_000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    // Try next hub
    this.currentHubIdx = (this.currentHubIdx + 1) % this.hubAddresses.length;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
        this.scheduleReconnect();
      }
    }, this.reconnectDelay);
  }

  private send(msg: ClusterWsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Sync local agent list to Hub */
  syncAgents(agents: string[]): void {
    this.send({
      type: 'agents_sync',
      machine_id: this.machineId,
      agents,
    });
  }
}
