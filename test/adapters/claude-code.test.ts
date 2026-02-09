import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so the mock fn is available when vi.mock factory runs (hoisted)
const { mockExec } = vi.hoisted(() => {
  return { mockExec: vi.fn() };
});

vi.mock('node:child_process', () => ({
  exec: mockExec,
}));

import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js';

/**
 * Helper: make mockExec resolve with given stdout/stderr.
 */
function mockExecSuccess(stdout = '', stderr = '') {
  mockExec.mockImplementation(
    (_cmd: string, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      callback(null, { stdout, stderr });
    },
  );
}

/**
 * Helper: make mockExec reject with an error.
 */
function mockExecFailure(message = 'command failed') {
  mockExec.mockImplementation(
    (_cmd: string, callback: (err: Error | null) => void) => {
      callback(new Error(message));
    },
  );
}

describe('ClaudeCodeAdapter', () => {
  let adapter: ClaudeCodeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ClaudeCodeAdapter('test-session');
  });

  describe('listAgents', () => {
    it('parses tmux output correctly', async () => {
      mockExecSuccess('agent-1|1\nagent-2|0\n');

      const agents = await adapter.listAgents();

      expect(agents).toEqual([
        { id: 'agent-1', type: 'claude-code', status: 'running', persistent: false },
        { id: 'agent-2', type: 'claude-code', status: 'idle', persistent: false },
      ]);
    });

    it('returns empty array when tmux session does not exist', async () => {
      mockExecFailure('session not found');

      const agents = await adapter.listAgents();

      expect(agents).toEqual([]);
    });
  });

  describe('hasAgent', () => {
    it('returns true when window exists', async () => {
      mockExecSuccess();

      const result = await adapter.hasAgent('agent-1');

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        'tmux select-window -t test-session:agent-1 2>/dev/null',
        expect.any(Function),
      );
    });

    it('returns false when window does not exist', async () => {
      mockExecFailure('window not found');

      const result = await adapter.hasAgent('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('calls tmux send-keys with correct args', async () => {
      mockExecSuccess();

      await adapter.sendMessage('agent-1', 'user', 'hello world');

      expect(mockExec).toHaveBeenCalledWith(
        "tmux send-keys -t test-session:agent-1 'hello world' Enter",
        expect.any(Function),
      );
    });
  });

  describe('spawnAgent', () => {
    it('calls tmux new-window and returns agent id', async () => {
      mockExecSuccess();

      const agentId = await adapter.spawnAgent({
        type: 'claude-code',
        agent_id: 'my-agent',
        task: 'do something',
      });

      expect(agentId).toBe('my-agent');
      expect(mockExec).toHaveBeenCalledWith(
        `tmux new-window -t test-session -n my-agent "claude --print 'do something'"`,
        expect.any(Function),
      );
    });
  });

  describe('stopAgent', () => {
    it('calls tmux kill-window', async () => {
      mockExecSuccess();

      await adapter.stopAgent('agent-1');

      expect(mockExec).toHaveBeenCalledWith(
        'tmux kill-window -t test-session:agent-1',
        expect.any(Function),
      );
    });
  });
});
