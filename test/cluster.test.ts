import { describe, it, expect, beforeEach } from 'vitest';
import { ClusterManager } from '../src/cluster.js';
import type { ClusterMember } from '../src/cluster.js';

function makeMember(overrides: Partial<ClusterMember> = {}): ClusterMember {
  return {
    machine_id: 'node-1',
    type: 'hub',
    bridge_url: 'http://node-1:9100',
    capabilities: ['openclaw'],
    agents: [],
    last_seen: Date.now(),
    ...overrides,
  };
}

describe('ClusterManager', () => {
  let cm: ClusterManager;

  beforeEach(() => {
    cm = new ClusterManager('self-node');
  });

  describe('getSelfId()', () => {
    it('returns the selfId passed to constructor', () => {
      expect(cm.getSelfId()).toBe('self-node');
    });
  });

  describe('setSecret / getSecret', () => {
    it('defaults to null', () => {
      expect(cm.getSecret()).toBeNull();
    });

    it('stores and retrieves secret', () => {
      cm.setSecret('ab_test123');
      expect(cm.getSecret()).toBe('ab_test123');
    });
  });

  describe('addMember()', () => {
    it('adds a member retrievable by getMember', () => {
      cm.addMember(makeMember({ machine_id: 'node-a' }));
      const m = cm.getMember('node-a');
      expect(m).toBeDefined();
      expect(m!.machine_id).toBe('node-a');
      expect(m!.type).toBe('hub');
    });

    it('overwrites existing member with same machine_id', () => {
      cm.addMember(makeMember({ machine_id: 'node-a', capabilities: ['openclaw'] }));
      cm.addMember(makeMember({ machine_id: 'node-a', capabilities: ['claude-code'] }));
      const m = cm.getMember('node-a');
      expect(m!.capabilities).toEqual(['claude-code']);
    });

    it('sets last_seen to current time', () => {
      const before = Date.now();
      cm.addMember(makeMember({ machine_id: 'node-a' }));
      const after = Date.now();
      const m = cm.getMember('node-a')!;
      expect(m.last_seen).toBeGreaterThanOrEqual(before);
      expect(m.last_seen).toBeLessThanOrEqual(after);
    });
  });

  describe('getMember()', () => {
    it('returns undefined for unknown machine_id', () => {
      expect(cm.getMember('nonexistent')).toBeUndefined();
    });

    it('returns correct member', () => {
      cm.addMember(makeMember({ machine_id: 'x' }));
      cm.addMember(makeMember({ machine_id: 'y' }));
      expect(cm.getMember('x')!.machine_id).toBe('x');
      expect(cm.getMember('y')!.machine_id).toBe('y');
    });
  });

  describe('getMembers()', () => {
    it('returns empty array initially', () => {
      expect(cm.getMembers()).toEqual([]);
    });

    it('returns all members', () => {
      cm.addMember(makeMember({ machine_id: 'a' }));
      cm.addMember(makeMember({ machine_id: 'b' }));
      cm.addMember(makeMember({ machine_id: 'c' }));
      expect(cm.getMembers()).toHaveLength(3);
    });
  });

  describe('removeMember()', () => {
    it('removes an existing member', () => {
      cm.addMember(makeMember({ machine_id: 'node-a' }));
      expect(cm.getMember('node-a')).toBeDefined();
      cm.removeMember('node-a');
      expect(cm.getMember('node-a')).toBeUndefined();
    });

    it('does nothing for unknown machine_id', () => {
      cm.addMember(makeMember({ machine_id: 'node-a' }));
      cm.removeMember('nonexistent');
      expect(cm.getMembers()).toHaveLength(1);
    });
  });

  describe('getHubs()', () => {
    it('returns only hub type members', () => {
      cm.addMember(makeMember({ machine_id: 'hub-1', type: 'hub' }));
      cm.addMember(makeMember({ machine_id: 'edge-1', type: 'edge' }));
      cm.addMember(makeMember({ machine_id: 'hub-2', type: 'hub' }));

      const hubs = cm.getHubs();
      expect(hubs).toHaveLength(2);
      expect(hubs.every((h) => h.type === 'hub')).toBe(true);
    });

    it('returns empty when no hubs', () => {
      cm.addMember(makeMember({ machine_id: 'edge-1', type: 'edge' }));
      expect(cm.getHubs()).toHaveLength(0);
    });
  });

  describe('touch()', () => {
    it('updates last_seen timestamp', async () => {
      cm.addMember(makeMember({ machine_id: 'node-a' }));
      const oldSeen = cm.getMember('node-a')!.last_seen;

      // Small delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 10));
      cm.touch('node-a');

      const newSeen = cm.getMember('node-a')!.last_seen;
      expect(newSeen).toBeGreaterThan(oldSeen);
    });

    it('does nothing for unknown machine_id', () => {
      // Should not throw
      cm.touch('nonexistent');
    });
  });

  describe('updateAgents()', () => {
    it('updates agent list for a member', () => {
      cm.addMember(makeMember({ machine_id: 'node-a', agents: [] }));
      cm.updateAgents('node-a', ['agent-1', 'agent-2']);
      expect(cm.getMember('node-a')!.agents).toEqual(['agent-1', 'agent-2']);
    });

    it('does nothing for unknown machine_id', () => {
      // Should not throw
      cm.updateAgents('nonexistent', ['agent-1']);
    });
  });

  describe('toLegacyCluster()', () => {
    it('returns correct format with hub members', () => {
      cm.addMember(makeMember({ machine_id: 'hub-1', type: 'hub', bridge_url: 'http://hub-1:9100' }));
      cm.addMember(makeMember({ machine_id: 'hub-2', type: 'hub', bridge_url: 'http://hub-2:9100' }));

      const legacy = cm.toLegacyCluster();
      expect(legacy.machines).toHaveLength(2);
      expect(legacy.machines[0]).toEqual({ id: 'hub-1', bridge: 'http://hub-1:9100', role: 'worker' });
      expect(legacy.machines[1]).toEqual({ id: 'hub-2', bridge: 'http://hub-2:9100', role: 'worker' });
    });

    it('excludes self from legacy cluster', () => {
      cm.addMember(makeMember({ machine_id: 'self-node', type: 'hub', bridge_url: 'http://self:9100' }));
      cm.addMember(makeMember({ machine_id: 'other', type: 'hub', bridge_url: 'http://other:9100' }));

      const legacy = cm.toLegacyCluster();
      expect(legacy.machines).toHaveLength(1);
      expect(legacy.machines[0].id).toBe('other');
    });

    it('excludes edge members', () => {
      cm.addMember(makeMember({ machine_id: 'hub-1', type: 'hub', bridge_url: 'http://hub-1:9100' }));
      cm.addMember(makeMember({ machine_id: 'edge-1', type: 'edge' }));

      const legacy = cm.toLegacyCluster();
      expect(legacy.machines).toHaveLength(1);
      expect(legacy.machines[0].id).toBe('hub-1');
    });

    it('excludes hubs without bridge_url', () => {
      cm.addMember(makeMember({ machine_id: 'hub-no-url', type: 'hub', bridge_url: undefined }));

      const legacy = cm.toLegacyCluster();
      expect(legacy.machines).toHaveLength(0);
    });

    it('returns empty machines array when no members', () => {
      const legacy = cm.toLegacyCluster();
      expect(legacy).toEqual({ machines: [] });
    });
  });
});
