import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Adapter, AgentInfo, SpawnOptions } from './types.js';

const execAsync = promisify(exec);

export class ClaudeCodeAdapter implements Adapter {
  readonly type = 'claude-code' as const;

  private tmuxSession: string;

  constructor(tmuxSession: string = 'agents') {
    this.tmuxSession = tmuxSession;
  }

  async connect(): Promise<void> {
    // ensure tmux session exists
    try {
      await execAsync(`tmux has-session -t ${this.tmuxSession} 2>/dev/null`);
    } catch {
      await execAsync(`tmux new-session -d -s ${this.tmuxSession}`);
      console.log(`[CC] Created tmux session: ${this.tmuxSession}`);
    }
  }

  async disconnect(): Promise<void> {
    // no-op: don't kill the tmux session on disconnect
  }

  async sendMessage(agentId: string, _from: string, message: string): Promise<void> {
    const escaped = message.replace(/'/g, "'\\''");
    await execAsync(
      `tmux send-keys -t ${this.tmuxSession}:${agentId} '${escaped}' Enter`,
    );
  }

  async listAgents(): Promise<AgentInfo[]> {
    try {
      const { stdout } = await execAsync(
        `tmux list-windows -t ${this.tmuxSession} -F '#{window_name}|#{window_active}'`,
      );
      return stdout
        .trim()
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          const [name, active] = line.split('|');
          return {
            id: name,
            type: 'claude-code' as const,
            status: active === '1' ? 'running' as const : 'idle' as const,
            persistent: false,
          };
        });
    } catch {
      return [];
    }
  }

  async hasAgent(agentId: string): Promise<boolean> {
    try {
      await execAsync(
        `tmux select-window -t ${this.tmuxSession}:${agentId} 2>/dev/null`,
      );
      return true;
    } catch {
      return false;
    }
  }

  async spawnAgent(options: SpawnOptions): Promise<string> {
    const agentId = options.agent_id || `cc-${Date.now().toString(36)}`;
    const task = options.task.replace(/'/g, "'\\''");
    await execAsync(
      `tmux new-window -t ${this.tmuxSession} -n ${agentId} "claude --print '${task}'"`,
    );
    console.log(`[CC] Spawned agent: ${agentId}`);
    return agentId;
  }

  async stopAgent(agentId: string): Promise<void> {
    await execAsync(
      `tmux kill-window -t ${this.tmuxSession}:${agentId}`,
    );
    console.log(`[CC] Stopped agent: ${agentId}`);
  }
}
