import { readFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from './logger.js';

// --- Types ---

export interface PersistentAgent {
  id: string;
  type: 'openclaw' | 'claude-code';
  auto_start: boolean;
  workspace: string;
}

export interface BridgeConfig {
  machine_id: string;
  port: number;
  capabilities: ('openclaw' | 'claude-code')[];
  max_agents: number;
  persistent_agents: PersistentAgent[];
  adapters: {
    openclaw?: { gateway: string };
    claude_code?: { tmux_session: string; happy_daemon?: string };
  };
}

export interface ClusterMachine {
  id: string;
  bridge: string;
  role: string;
}

export interface ClusterConfig {
  machines: ClusterMachine[];
}

// --- Loader ---

function loadJSON<T>(path: string): T {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content) as T;
}

export function loadConfig(): { bridge: BridgeConfig; cluster: ClusterConfig } {
  const configPath = process.env.CONFIG_PATH || './config/bridge.json';
  const clusterPath = process.env.CLUSTER_PATH || './config/cluster.json';

  const bridgePath = resolve(configPath);
  if (!existsSync(bridgePath)) {
    const examplePath = resolve(configPath.replace('.json', '.example.json'));
    if (existsSync(examplePath)) {
      copyFileSync(examplePath, bridgePath);
      log.info('Config', `Created ${configPath} from ${configPath.replace('.json', '.example.json')}`);
    } else {
      throw new Error(`Bridge config not found: ${bridgePath}`);
    }
  }

  const bridge = loadJSON<BridgeConfig>(bridgePath);

  // env overrides
  if (process.env.PORT) bridge.port = Number(process.env.PORT);
  if (process.env.MACHINE_ID) bridge.machine_id = process.env.MACHINE_ID;

  const resolvedClusterPath = resolve(clusterPath);
  let cluster: ClusterConfig;
  if (existsSync(resolvedClusterPath)) {
    cluster = loadJSON<ClusterConfig>(resolvedClusterPath);
  } else {
    const clusterExamplePath = resolve(clusterPath.replace('.json', '.example.json'));
    if (existsSync(clusterExamplePath)) {
      copyFileSync(clusterExamplePath, resolvedClusterPath);
      log.info('Config', `Created ${clusterPath} from ${clusterPath.replace('.json', '.example.json')}`);
      cluster = loadJSON<ClusterConfig>(resolvedClusterPath);
    } else {
      cluster = { machines: [] };
    }
  }

  return { bridge, cluster };
}
