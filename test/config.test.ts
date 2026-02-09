import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We need to import loadConfig fresh for each test because it reads process.env
// at call time, so we can manipulate env vars before each call.
import { loadConfig } from '../src/config.js';

const TMP = join(tmpdir(), 'agent-bridge-test-config-' + Date.now());

const sampleBridge = {
  machine_id: 'cloud-a',
  port: 9100,
  capabilities: ['openclaw'],
  max_agents: 5,
  persistent_agents: [],
  adapters: { openclaw: { gateway: 'ws://127.0.0.1:18789' } },
};

const sampleCluster = {
  machines: [
    { id: 'cloud-a', bridge: 'http://100.64.0.2:9100', role: 'primary' },
  ],
};

function writeBridge(data: object = sampleBridge) {
  writeFileSync(join(TMP, 'bridge.json'), JSON.stringify(data));
}

function writeCluster(data: object = sampleCluster) {
  writeFileSync(join(TMP, 'cluster.json'), JSON.stringify(data));
}

describe('loadConfig', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
    // Point config loader at our temp directory
    process.env.CONFIG_PATH = join(TMP, 'bridge.json');
    process.env.CLUSTER_PATH = join(TMP, 'cluster.json');
    // Clear override env vars
    delete process.env.PORT;
    delete process.env.MACHINE_ID;
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    delete process.env.CONFIG_PATH;
    delete process.env.CLUSTER_PATH;
    delete process.env.PORT;
    delete process.env.MACHINE_ID;
  });

  it('loads valid bridge.json and cluster.json', () => {
    writeBridge();
    writeCluster();

    const { bridge, cluster } = loadConfig();

    expect(bridge.machine_id).toBe('cloud-a');
    expect(bridge.port).toBe(9100);
    expect(bridge.capabilities).toEqual(['openclaw']);
    expect(bridge.max_agents).toBe(5);
    expect(cluster.machines).toHaveLength(1);
    expect(cluster.machines[0].id).toBe('cloud-a');
  });

  it('overrides port via PORT env variable', () => {
    writeBridge();
    writeCluster();
    process.env.PORT = '3000';

    const { bridge } = loadConfig();

    expect(bridge.port).toBe(3000);
  });

  it('overrides machine_id via MACHINE_ID env variable', () => {
    writeBridge();
    writeCluster();
    process.env.MACHINE_ID = 'override-machine';

    const { bridge } = loadConfig();

    expect(bridge.machine_id).toBe('override-machine');
  });

  it('throws error when bridge.json is missing', () => {
    // Do not write bridge.json — only cluster
    writeCluster();

    expect(() => loadConfig()).toThrow(/Bridge config not found/);
  });

  it('returns empty machines array when cluster.json is missing', () => {
    writeBridge();
    // Do not write cluster.json

    const { cluster } = loadConfig();

    expect(cluster.machines).toEqual([]);
  });
});
