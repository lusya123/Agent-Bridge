import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { Router } from './router.js';
import { OpenClawAdapter } from './adapters/openclaw.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.js';
import type { Adapter } from './adapters/types.js';
import { infoHandler } from './api/info.js';
import { agentsHandler } from './api/agents.js';
import { locateHandler } from './api/locate.js';
import { messageHandler } from './api/message.js';
import { spawnHandler } from './api/spawn.js';
import { stopHandler } from './api/stop.js';

async function main() {
  const { bridge: config, cluster } = loadConfig();
  const adapters: Adapter[] = [];

  // initialize OpenClaw adapter
  if (config.capabilities.includes('openclaw') && config.adapters.openclaw) {
    const oc = new OpenClawAdapter(config.adapters.openclaw.gateway);
    try {
      await oc.connect();
      adapters.push(oc);
    } catch (err) {
      console.warn('[Bridge] OpenClaw adapter failed to connect, skipping:',
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
      console.warn('[Bridge] Claude Code adapter failed to connect, skipping:',
        err instanceof Error ? err.message : err);
    }
  }

  const router = new Router(config, cluster, adapters);
  const app = new Hono();

  // register routes
  app.get('/info', infoHandler(config, adapters));
  app.get('/agents', agentsHandler(adapters));
  app.get('/locate', locateHandler(config, cluster, adapters));
  app.post('/message', messageHandler(router));
  app.post('/spawn', spawnHandler(config, cluster, adapters));
  app.post('/stop', stopHandler(adapters));

  const port = config.port;
  console.log(`[Bridge] Starting on :${port}`);
  console.log(`[Bridge] Machine: ${config.machine_id}`);
  console.log(`[Bridge] Capabilities: ${config.capabilities.join(', ')}`);
  console.log(`[Bridge] Adapters: ${adapters.map((a) => a.type).join(', ') || 'none'}`);
  console.log(`[Bridge] Cluster: ${cluster.machines.length} machines`);

  serve({ fetch: app.fetch, port });
}

main().catch((err) => {
  console.error('[Bridge] Fatal:', err);
  process.exit(1);
});
