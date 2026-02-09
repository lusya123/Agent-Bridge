type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: Level = (process.env.LOG_LEVEL as Level) || 'info';

function timestamp(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function emit(level: Level, tag: string, args: unknown[]): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const prefix = `[${timestamp()}] [${level.toUpperCase()}] [${tag}]`;
  const fn = level === 'error' ? console.error
    : level === 'warn' ? console.warn
    : console.log;
  fn(prefix, ...args);
}

export const log = {
  debug(tag: string, ...args: unknown[]): void { emit('debug', tag, args); },
  info(tag: string, ...args: unknown[]): void { emit('info', tag, args); },
  warn(tag: string, ...args: unknown[]): void { emit('warn', tag, args); },
  error(tag: string, ...args: unknown[]): void { emit('error', tag, args); },
  setLevel(level: Level): void { currentLevel = level; },
};
