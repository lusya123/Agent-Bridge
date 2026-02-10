import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { Router } from './router.js';
import { HeartbeatManager } from './heartbeat.js';
import { OpenClawAdapter } from './adapters/openclaw.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.js';
import type { Adapter } from './adapters/types.js';
import { infoHandler } from './api/info.js';
import { agentsHandler } from './api/agents.js';
import { locateHandler } from './api/locate.js';
import { messageHandler } from './api/message.js';
import { spawnHandler } from './api/spawn.js';
import { stopHandler } from './api/stop.js';
import { testMessagesHandler } from './api/test-messages.js';
import { log } from './logger.js';

export async function main() {
  const { bridge: config, cluster } = loadConfig();
  const adapters: Adapter[] = [];

  // initialize OpenClaw adapter
  if (config.capabilities.includes('openclaw') && config.adapters.openclaw) {
    const oc = new OpenClawAdapter(config.adapters.openclaw.gateway, config.adapters.openclaw.token);
    try {
      await oc.connect();
      adapters.push(oc);
    } catch (err) {
      log.warn('Bridge', 'OpenClaw adapter failed to connect, skipping:',
        err instanceof Error ? err.message : err);
    }
  }

  // initialize Claude Code adapter
  if (config.capabilities.includes('claude-code') && config.adapters.claude_code) {
    const cc = new ClaudeCodeAdapter(config.adapters.claude_code.tmux_session);
    try {
      await cc.connect();
      adapters.push(cc);
    } catch (err) {
      log.warn('Bridge', 'Claude Code adapter failed to connect, skipping:',
        err instanceof Error ? err.message : err);
    }
  }

  // initialize Test adapter (for integration testing without real services)
  if (config.capabilities.includes('test')) {
    const { TestAdapter } = await import('./adapters/test.js');
    const ta = new TestAdapter();
    await ta.connect();
    adapters.push(ta);
  }

  const router = new Router(config, cluster, adapters);
  const heartbeat = new HeartbeatManager();
  heartbeat.load(resolve('data/heartbeats.json'));

  const app = new Hono();

  // register routes
  app.get('/info', infoHandler(config, adapters));
  app.get('/agents', agentsHandler(adapters));
  app.get('/locate', locateHandler(config, cluster, adapters));
  app.post('/message', messageHandler(router));
  app.post('/spawn', spawnHandler(config, cluster, adapters, heartbeat));
  app.post('/stop', stopHandler(adapters, heartbeat));
  app.get('/test/messages', testMessagesHandler(adapters));

  const port = config.port;
  log.info('Bridge', `Starting on :${port}`);
  log.info('Bridge', `Machine: ${config.machine_id}`);
  log.info('Bridge', `Capabilities: ${config.capabilities.join(', ')}`);
  log.info('Bridge', `Adapters: ${adapters.map((a) => a.type).join(', ') || 'none'}`);
  log.info('Bridge', `Cluster: ${cluster.machines.length} machines`);
  log.info('Bridge', `Heartbeats: ${heartbeat.list().length} active`);

  serve({ fetch: app.fetch, port });
}

// Only auto-start when run directly (not when imported by cli.ts)
const isDirectRun = process.argv[1]?.endsWith('/index.js') || process.argv[1]?.endsWith('/index.ts');
if (isDirectRun) {
  main().catch((err) => {
    log.error('Bridge', 'Fatal:', err);
    process.exit(1);
  });
}
