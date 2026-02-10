import type { Adapter, AgentInfo, SpawnOptions } from './types.js';
import { log } from '../logger.js';

export class TestAdapter implements Adapter {
  readonly type = 'generic' as const;
  private agents = new Map<string, AgentInfo>();
  private messages = new Map<string, Array<{ from: string; message: string; ts: number }>>();

  async connect(): Promise<void> {
    log.info('TestAdapter', 'Connected (in-memory test adapter)');
  }

  async disconnect(): Promise<void> {
    this.agents.clear();
    this.messages.clear();
  }

  async sendMessage(agentId: string, from: string, message: string): Promise<void> {
    if (!this.agents.has(agentId)) {
      throw new Error(`Agent "${agentId}" not found in test adapter`);
    }
    const inbox = this.messages.get(agentId) || [];
    inbox.push({ from, message, ts: Date.now() });
    this.messages.set(agentId, inbox);
    log.debug('TestAdapter', `Message to ${agentId} from ${from}: ${message}`);
  }

  async listAgents(): Promise<AgentInfo[]> {
    return Array.from(this.agents.values());
  }

  async hasAgent(agentId: string): Promise<boolean> {
    return this.agents.has(agentId);
  }

  async spawnAgent(options: SpawnOptions): Promise<string> {
    const id = options.agent_id || `test-${Date.now().toString(36)}`;
    this.agents.set(id, {
      id,
      type: 'generic',
      status: 'running',
      persistent: options.persistent ?? false,
      task: options.task,
    });
    this.messages.set(id, []);
    log.info('TestAdapter', `Spawned agent: ${id}`);
    return id;
  }

  async stopAgent(agentId: string): Promise<void> {
    this.agents.delete(agentId);
    this.messages.delete(agentId);
    log.info('TestAdapter', `Stopped agent: ${agentId}`);
  }

  getMessages(agentId: string): Array<{ from: string; message: string; ts: number }> {
    return this.messages.get(agentId) || [];
  }
}
