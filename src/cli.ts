#!/usr/bin/env node

import { log } from './logger.js';
import { main } from './index.js';

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

if (args.includes('--debug')) {
  process.env.LOG_LEVEL = 'debug';
  log.setLevel('debug');
}

const port = getArg('--port');
if (port) process.env.PORT = port;

const config = getArg('--config');
if (config) process.env.CONFIG_PATH = config;

main().catch((err) => {
  log.error('Bridge', 'Fatal:', err);
  process.exit(1);
});
