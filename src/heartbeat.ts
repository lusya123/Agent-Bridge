import cron from 'node-cron';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { log } from './logger.js';

export interface HeartbeatEntry {
  agentId: string;
  schedule: string;   // cron key like "hourly"
  cronExpr: string;   // resolved cron expression
  message: string;
}

interface StoredHeartbeats {
  [agentId: string]: { heartbeat: Record<string, string>; port: number };
}

// Map friendly names to cron expressions
const SCHEDULE_MAP: Record<string, string> = {
  hourly: '0 * * * *',
  daily_9am: '0 9 * * *',
  weekly_monday: '0 9 * * 1',
};

export class HeartbeatManager {
  private jobs = new Map<string, cron.ScheduledTask[]>();
  private entries = new Map<string, HeartbeatEntry[]>();
  private stored: StoredHeartbeats = {};
  private persistPath: string | null = null;

  add(agentId: string, heartbeat: Record<string, string>, port: number): void {
    // remove existing heartbeats for this agent first
    this.remove(agentId);

    const tasks: cron.ScheduledTask[] = [];
    const entryList: HeartbeatEntry[] = [];

    for (const [schedule, message] of Object.entries(heartbeat)) {
      const cronExpr = SCHEDULE_MAP[schedule] || schedule;
      if (!cron.validate(cronExpr)) {
        log.warn('Heartbeat', `Invalid schedule "${schedule}" (${cronExpr}) for ${agentId}, skipping`);
        continue;
      }

      const task = cron.schedule(cronExpr, async () => {
        try {
          await fetch(`http://localhost:${port}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: agentId, from: 'system', message }),
          });
          log.debug('Heartbeat', `Sent "${schedule}" to ${agentId}`);
        } catch (err) {
          log.warn('Heartbeat', `Failed to send "${schedule}" to ${agentId}:`,
            err instanceof Error ? err.message : err);
        }
      });

      tasks.push(task);
      entryList.push({ agentId, schedule, cronExpr, message });
    }

    if (tasks.length > 0) {
      this.jobs.set(agentId, tasks);
      this.entries.set(agentId, entryList);
      this.stored[agentId] = { heartbeat, port };
      this.save();
      log.info('Heartbeat', `Registered ${tasks.length} schedule(s) for ${agentId}`);
    }
  }

  remove(agentId: string): void {
    const tasks = this.jobs.get(agentId);
    if (tasks) {
      tasks.forEach((t) => t.stop());
      this.jobs.delete(agentId);
      this.entries.delete(agentId);
      delete this.stored[agentId];
      this.save();
      log.info('Heartbeat', `Removed schedules for ${agentId}`);
    }
  }

  list(): HeartbeatEntry[] {
    const all: HeartbeatEntry[] = [];
    for (const entries of this.entries.values()) {
      all.push(...entries);
    }
    return all;
  }

  stopAll(): void {
    for (const [agentId, tasks] of this.jobs) {
      tasks.forEach((t) => t.stop());
    }
    this.jobs.clear();
    this.entries.clear();
  }

  load(filePath: string): void {
    this.persistPath = filePath;
    if (!existsSync(filePath)) return;
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as StoredHeartbeats;
      for (const [agentId, { heartbeat, port }] of Object.entries(data)) {
        this.add(agentId, heartbeat, port);
      }
    } catch (err) {
      log.warn('Heartbeat', 'Failed to load saved heartbeats:', err instanceof Error ? err.message : err);
    }
  }

  private save(): void {
    if (!this.persistPath) return;
    try {
      const dir = dirname(this.persistPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.persistPath, JSON.stringify(this.stored, null, 2));
    } catch (err) {
      log.warn('Heartbeat', 'Failed to save heartbeats:', err instanceof Error ? err.message : err);
    }
  }
}
