export interface AgentInfo {
  id: string;
  type: 'openclaw' | 'claude-code' | 'generic';
  status: 'running' | 'idle' | 'stopped';
  persistent: boolean;
  task?: string;
  description?: string;
}

export interface SpawnOptions {
  type: 'openclaw' | 'claude-code' | 'generic';
  agent_id: string;
  task: string;
  machine?: string;
  persistent?: boolean;
  heartbeat?: Record<string, string>;
}

export interface Adapter {
  readonly type: 'openclaw' | 'claude-code' | 'generic';

  sendMessage(agentId: string, from: string, message: string): Promise<void>;
  listAgents(): Promise<AgentInfo[]>;
  hasAgent(agentId: string): Promise<boolean>;

  spawnAgent?(options: SpawnOptions): Promise<string>;
  stopAgent?(agentId: string): Promise<void>;

  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
}
