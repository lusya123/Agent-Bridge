import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatManager } from '../src/heartbeat.js';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock node-cron
vi.mock('node-cron', () => {
  const tasks: Array<{ cronExpr: string; callback: () => void; stopped: boolean }> = [];
  return {
    default: {
      schedule: vi.fn((cronExpr: string, callback: () => void) => {
        const task = { cronExpr, callback, stopped: false };
        tasks.push(task);
        return { stop: vi.fn(() => { task.stopped = true; }) };
      }),
      validate: vi.fn((expr: string) => {
        // Accept known patterns and standard 5-field cron
        const known = ['0 * * * *', '0 9 * * *', '0 9 * * 1'];
        if (known.includes(expr)) return true;
        return /^[\d*,/-]+ [\d*,/-]+ [\d*,/-]+ [\d*,/-]+ [\d*,/-]+$/.test(expr);
      }),
    },
  };
});

describe('HeartbeatManager', () => {
  let hb: HeartbeatManager;

  beforeEach(() => {
    hb = new HeartbeatManager();
  });

  afterEach(() => {
    hb.stopAll();
  });

  it('adds heartbeat schedules for an agent', () => {
    hb.add('CEO', { hourly: '[小心跳] check', daily_9am: '[日心跳] plan' }, 9100);

    const entries = hb.list();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      agentId: 'CEO',
      schedule: 'hourly',
      cronExpr: '0 * * * *',
      message: '[小心跳] check',
    });
    expect(entries[1]).toMatchObject({
      agentId: 'CEO',
      schedule: 'daily_9am',
      cronExpr: '0 9 * * *',
    });
  });

  it('maps schedule keys to cron expressions', () => {
    hb.add('agent1', {
      hourly: 'h',
      daily_9am: 'd',
      weekly_monday: 'w',
    }, 9100);

    const entries = hb.list();
    const exprs = entries.map((e) => e.cronExpr);
    expect(exprs).toContain('0 * * * *');
    expect(exprs).toContain('0 9 * * *');
    expect(exprs).toContain('0 9 * * 1');
  });

  it('accepts custom cron expressions as keys', () => {
    hb.add('agent2', { '30 8 * * *': 'custom schedule' }, 9100);

    const entries = hb.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].cronExpr).toBe('30 8 * * *');
  });

  it('removes heartbeat schedules for an agent', () => {
    hb.add('CEO', { hourly: 'check' }, 9100);
    expect(hb.list()).toHaveLength(1);

    hb.remove('CEO');
    expect(hb.list()).toHaveLength(0);
  });

  it('replaces existing schedules on re-add', () => {
    hb.add('CEO', { hourly: 'old' }, 9100);
    hb.add('CEO', { daily_9am: 'new' }, 9100);

    const entries = hb.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].schedule).toBe('daily_9am');
  });

  it('stopAll clears all schedules', () => {
    hb.add('a1', { hourly: 'h1' }, 9100);
    hb.add('a2', { hourly: 'h2' }, 9100);
    expect(hb.list()).toHaveLength(2);

    hb.stopAll();
    expect(hb.list()).toHaveLength(0);
  });

  it('skips invalid cron expressions', () => {
    hb.add('bad', { 'not-a-cron': 'msg' }, 9100);
    expect(hb.list()).toHaveLength(0);
  });

  describe('persistence', () => {
    it('saves and loads heartbeats from file', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'hb-test-'));
      const filePath = join(tmpDir, 'heartbeats.json');

      // save
      hb.load(filePath);
      hb.add('CEO', { hourly: 'check' }, 9100);
      expect(existsSync(filePath)).toBe(true);

      // load in new instance
      const hb2 = new HeartbeatManager();
      hb2.load(filePath);
      expect(hb2.list()).toHaveLength(1);
      expect(hb2.list()[0].agentId).toBe('CEO');
      hb2.stopAll();
    });

    it('handles missing file gracefully', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'hb-test-'));
      const filePath = join(tmpDir, 'nonexistent.json');

      hb.load(filePath);
      expect(hb.list()).toHaveLength(0);
    });
  });
});
