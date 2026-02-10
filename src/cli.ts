#!/usr/bin/env node

import { log } from './logger.js';
import { main } from './index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const command = args[0];

function getArg(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

// --- Plugin install/uninstall ---

const OPENCLAW_DIR = path.join(process.env.HOME || '~', '.openclaw');
const PLUGIN_TARGET = path.join(OPENCLAW_DIR, 'extensions', 'agent-bridge');

function getPluginSource(): string {
  // In dev: src/openclaw-plugin/  In dist: resolve relative to cli.js
  const thisFile = fileURLToPath(import.meta.url);
  const srcPlugin = path.join(path.dirname(thisFile), 'openclaw-plugin');
  if (fs.existsSync(srcPlugin)) return srcPlugin;
  // Fallback: project root src/openclaw-plugin
  const projectRoot = path.resolve(path.dirname(thisFile), '..');
  const fallback = path.join(projectRoot, 'src', 'openclaw-plugin');
  if (fs.existsSync(fallback)) return fallback;
  throw new Error('Cannot find openclaw-plugin source directory');
}

function copyDirSync(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function install() {
  if (!fs.existsSync(OPENCLAW_DIR)) {
    console.error(`Error: ${OPENCLAW_DIR} not found. Please install OpenClaw first.`);
    process.exit(1);
  }

  const source = getPluginSource();
  copyDirSync(source, PLUGIN_TARGET);
  console.log(`Installed agent-bridge plugin to ${PLUGIN_TARGET}`);
  console.log('Restart OpenClaw Gateway to activate the plugin.');
}

function uninstall() {
  if (fs.existsSync(PLUGIN_TARGET)) {
    fs.rmSync(PLUGIN_TARGET, { recursive: true, force: true });
    console.log(`Removed agent-bridge plugin from ${PLUGIN_TARGET}`);
  } else {
    console.log('Plugin not installed, nothing to remove.');
  }
}

// --- Main ---

if (command === 'install') {
  install();
  process.exit(0);
}

if (command === 'uninstall') {
  uninstall();
  process.exit(0);
}

// "start" or no command → start server (auto-install if needed)
if (command === 'start' || !command || command.startsWith('--')) {
  // Auto-install plugin if OpenClaw is present but plugin is missing
  if (fs.existsSync(OPENCLAW_DIR) && !fs.existsSync(PLUGIN_TARGET)) {
    try {
      const source = getPluginSource();
      copyDirSync(source, PLUGIN_TARGET);
      console.log(`Auto-installed agent-bridge plugin to ${PLUGIN_TARGET}`);
    } catch {
      // Not critical — Bridge can run without plugin
    }
  }

  // Parse flags (skip "start" if present)
  const flagArgs = command === 'start' ? args.slice(1) : args;

  if (flagArgs.includes('--debug')) {
    process.env.LOG_LEVEL = 'debug';
    log.setLevel('debug');
  }

  const portIdx = flagArgs.indexOf('--port');
  if (portIdx !== -1) process.env.PORT = flagArgs[portIdx + 1];

  const configIdx = flagArgs.indexOf('--config');
  if (configIdx !== -1) process.env.CONFIG_PATH = flagArgs[configIdx + 1];

  main().catch((err) => {
    log.error('Bridge', 'Fatal:', err);
    process.exit(1);
  });
} else {
  console.error(`Unknown command: ${command}`);
  console.log('Usage: agent-bridge [install|uninstall|start] [--debug] [--port PORT] [--config PATH]');
  process.exit(1);
}
