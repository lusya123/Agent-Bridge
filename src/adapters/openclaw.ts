import WebSocket from 'ws';
import type { Adapter, AgentInfo, SpawnOptions } from './types.js';
import { log } from '../logger.js';

interface RPCRequest {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface RPCResponse {
  id: number;
  result?: unknown;
  error?: { message: string };
}

export class OpenClawAdapter implements Adapter {
  readonly type = 'openclaw' as const;

  private ws: WebSocket | null = null;
  private gateway: string;
  private rpcId = 0;
  private pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;

  constructor(gateway: string) {
    this.gateway = gateway;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.gateway);

      this.ws.on('open', () => {
        log.info('OpenClaw', `Connected to ${this.gateway}`);
        this.reconnectDelay = 1000;
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        log.debug('OpenClaw', 'Disconnected, scheduling reconnect...');
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        log.error('OpenClaw', 'WebSocket error:', err.message);
        if (this.ws?.readyState !== WebSocket.OPEN) {
          reject(err);
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
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

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as RPCResponse;
      const handler = this.pending.get(msg.id);
      if (!handler) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        handler.reject(new Error(msg.error.message));
      } else {
        handler.resolve(msg.result);
      }
    } catch {
      // ignore non-JSON messages
    }
  }

  private rpc(method: string, params: Record<string, unknown> = {}, timeout = 10000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('[OpenClaw] Not connected'));
      }
      const id = ++this.rpcId;
      const req: RPCRequest = { id, method, params };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[OpenClaw] RPC timeout: ${method}`));
      }, timeout);
      this.pending.set(id, {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      this.ws.send(JSON.stringify(req));
    });
  }

  async sendMessage(agentId: string, from: string, message: string): Promise<void> {
    await this.rpc('agent', { agentId, from, message });
  }

  async listAgents(): Promise<AgentInfo[]> {
    const result = await this.rpc('sessions.list') as Array<{
      id: string; status?: string; persistent?: boolean; task?: string;
    }>;
    return result.map((s) => ({
      id: s.id,
      type: 'openclaw' as const,
      status: (s.status as AgentInfo['status']) || 'running',
      persistent: s.persistent ?? true,
      task: s.task,
    }));
  }

  async hasAgent(agentId: string): Promise<boolean> {
    const agents = await this.listAgents();
    return agents.some((a) => a.id === agentId);
  }

  async spawnAgent(options: SpawnOptions): Promise<string> {
    await this.rpc('agent', {
      agentId: options.agent_id,
      message: options.task,
      newSession: true,
    });
    return options.agent_id;
  }

  async stopAgent(agentId: string): Promise<void> {
    await this.rpc('sessions.stop', { agentId });
  }
}