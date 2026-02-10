import WebSocket from 'ws';
import type { Adapter, AgentInfo, SpawnOptions } from './types.js';
import { log } from '../logger.js';

interface RPCRequest {
  type: 'req';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

interface RPCResponse {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; retryable?: boolean };
}

interface RPCEvent {
  type: 'event';
  event: string;
  payload: unknown;
}

type GatewayMessage = RPCResponse | RPCEvent;

export class OpenClawAdapter implements Adapter {
  readonly type = 'openclaw' as const;

  private ws: WebSocket | null = null;
  private gateway: string;
  private token: string;
  private rpcId = 0;
  private pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    twoPhase?: boolean;
    resolveOnAck?: boolean;
    acked?: boolean;
  }>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;

  constructor(gateway: string, token: string) {
    this.gateway = gateway;
    this.token = token;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.gateway);

      this.ws.on('open', async () => {
        log.info('OpenClaw', `WebSocket connected to ${this.gateway}`);
        this.reconnectDelay = 1000;
        try {
          await this.handshake();
          log.info('OpenClaw', 'Handshake successful');
          resolve();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
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

  private async handshake(): Promise<void> {
    const result = await this.rpc('connect', {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'gateway-client',
        version: '0.1.0',
        platform: process.platform,
        mode: 'backend',
      },
      role: 'operator',
      scopes: ['operator.read', 'operator.write', 'operator.admin'],
      caps: [],
      commands: [],
      permissions: {},
      auth: { token: this.token },
    });
    log.debug('OpenClaw', 'Handshake response:', JSON.stringify(result));
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
      const msg = JSON.parse(raw) as GatewayMessage;

      if (msg.type === 'event') {
        log.debug('OpenClaw', `Event: ${(msg as RPCEvent).event}`);
        return;
      }

      if (msg.type === 'res') {
        const res = msg as RPCResponse;
        const handler = this.pending.get(res.id);
        if (!handler) return;

        if (handler.twoPhase && !handler.acked) {
          handler.acked = true;
          log.debug('OpenClaw', `Ack received for RPC ${res.id}`);
          if (handler.resolveOnAck) {
            // For spawn/message: resolve immediately on ack (don't wait for LLM to finish)
            this.pending.delete(res.id);
            handler.resolve(res.payload);
            return;
          }
          // Otherwise keep waiting for final response
          return;
        }

        this.pending.delete(res.id);
        if (!res.ok) {
          handler.reject(new Error(
            `[OpenClaw] ${res.error?.code || 'ERROR'}: ${res.error?.message || 'Unknown error'}`
          ));
        } else {
          handler.resolve(res.payload);
        }
      }
    } catch {
      // ignore non-JSON messages
    }
  }

  private rpc(
    method: string,
    params: Record<string, unknown> = {},
    options: { timeout?: number; twoPhase?: boolean; resolveOnAck?: boolean } = {},
  ): Promise<unknown> {
    const { timeout = 10000, twoPhase = false, resolveOnAck = false } = options;
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('[OpenClaw] Not connected'));
      }
      const id = String(++this.rpcId);
      const req: RPCRequest = { type: 'req', id, method, params };

      const effectiveTimeout = twoPhase ? Math.max(timeout, 120000) : timeout;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[OpenClaw] RPC timeout: ${method}`));
      }, effectiveTimeout);

      this.pending.set(id, {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject: (err) => { clearTimeout(timer); reject(err); },
        twoPhase,
        resolveOnAck,
        acked: false,
      });
      this.ws.send(JSON.stringify(req));
    });
  }

  async sendMessage(agentId: string, from: string, message: string): Promise<void> {
    await this.rpc('agent', { agentId, from, message }, { twoPhase: true, resolveOnAck: true });
  }

  async listAgents(): Promise<AgentInfo[]> {
    const raw = await this.rpc('sessions.list');
    log.debug('OpenClaw', 'sessions.list raw:', JSON.stringify(raw));
    // Gateway may return an array directly or wrap it in { sessions: [...] }
    const result = Array.isArray(raw)
      ? raw
      : (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).sessions))
        ? (raw as Record<string, unknown>).sessions as Array<Record<string, unknown>>
        : [];
    return (result as Array<{
      key?: string; id?: string; status?: string; persistent?: boolean; task?: string;
      displayName?: string;
    }>).map((s) => {
      // Extract agent id from key format "agent:<agentId>:<sessionKey>" or fall back to id
      const id = s.id || (s.key ? s.key.split(':')[1] || s.key : 'unknown');
      return {
        id,
        type: 'openclaw' as const,
        status: (s.status as AgentInfo['status']) || 'running',
        persistent: s.persistent ?? true,
        task: s.task || s.displayName,
      };
    });
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
    }, { twoPhase: true, resolveOnAck: true });
    return options.agent_id;
  }

  async stopAgent(agentId: string): Promise<void> {
    // Use sessions.delete with the session key format "agent:<agentId>:<sessionKey>"
    // First try to find the actual session key from sessions.list
    const agents = await this.listAgents();
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) {
      throw new Error(`[OpenClaw] Agent ${agentId} not found`);
    }

    // Try sessions.delete with the agent's session key
    const raw = await this.rpc('sessions.list');
    const sessions = (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).sessions))
      ? (raw as Record<string, unknown>).sessions as Array<Record<string, unknown>>
      : Array.isArray(raw) ? raw as Array<Record<string, unknown>> : [];

    const session = sessions.find((s) => {
      const key = s.key as string | undefined;
      return key && key.split(':')[1] === agentId;
    });

    if (session?.key) {
      await this.rpc('sessions.delete', { key: session.key });
    } else {
      // Fallback: try with agentId directly
      await this.rpc('sessions.delete', { agentId });
    }
  }
}
