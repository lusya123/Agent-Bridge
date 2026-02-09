import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log } from '../src/logger.js';

describe('Logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.setLevel('info');
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('level filtering', () => {
    it('suppresses debug at default info level', () => {
      log.debug('Test', 'should not appear');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('outputs info at default info level', () => {
      log.info('Test', 'visible');
      expect(logSpy).toHaveBeenCalledTimes(1);
    });

    it('outputs warn at default info level', () => {
      log.warn('Test', 'visible');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('outputs error at default info level', () => {
      log.error('Test', 'visible');
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('setLevel', () => {
    it('debug level shows all messages', () => {
      log.setLevel('debug');
      log.debug('T', 'd');
      log.info('T', 'i');
      log.warn('T', 'w');
      log.error('T', 'e');
      expect(logSpy).toHaveBeenCalledTimes(2); // debug + info
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('warn level suppresses debug and info', () => {
      log.setLevel('warn');
      log.debug('T', 'd');
      log.info('T', 'i');
      log.warn('T', 'w');
      log.error('T', 'e');
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('error level only shows errors', () => {
      log.setLevel('error');
      log.debug('T', 'd');
      log.info('T', 'i');
      log.warn('T', 'w');
      log.error('T', 'e');
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('output format', () => {
    it('includes timestamp, level, and tag in prefix', () => {
      log.info('Bridge', 'hello world');
      expect(logSpy).toHaveBeenCalledTimes(1);
      const prefix = logSpy.mock.calls[0][0] as string;
      expect(prefix).toMatch(/^\[\d{2}:\d{2}:\d{2}\] \[INFO\] \[Bridge\]$/);
      expect(logSpy.mock.calls[0][1]).toBe('hello world');
    });

    it('debug prefix shows DEBUG tag', () => {
      log.setLevel('debug');
      log.debug('Router', 'detail');
      const prefix = logSpy.mock.calls[0][0] as string;
      expect(prefix).toMatch(/\[DEBUG\] \[Router\]$/);
    });

    it('warn prefix shows WARN tag', () => {
      log.warn('Heartbeat', 'oops');
      const prefix = warnSpy.mock.calls[0][0] as string;
      expect(prefix).toMatch(/\[WARN\] \[Heartbeat\]$/);
    });

    it('error prefix shows ERROR tag', () => {
      log.error('Bridge', 'fatal');
      const prefix = errorSpy.mock.calls[0][0] as string;
      expect(prefix).toMatch(/\[ERROR\] \[Bridge\]$/);
    });
  });

  describe('console method routing', () => {
    it('debug and info use console.log', () => {
      log.setLevel('debug');
      log.debug('T', 'a');
      log.info('T', 'b');
      expect(logSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('warn uses console.warn', () => {
      log.warn('T', 'w');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('error uses console.error', () => {
      log.error('T', 'e');
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('multiple arguments', () => {
    it('passes multiple args through to console', () => {
      log.info('Test', 'msg', 42, { key: 'val' });
      expect(logSpy).toHaveBeenCalledTimes(1);
      const args = logSpy.mock.calls[0];
      expect(args[1]).toBe('msg');
      expect(args[2]).toBe(42);
      expect(args[3]).toEqual({ key: 'val' });
    });

    it('handles error objects as args', () => {
      const err = new Error('boom');
      log.error('Test', 'Failed:', err.message);
      expect(errorSpy.mock.calls[0][1]).toBe('Failed:');
      expect(errorSpy.mock.calls[0][2]).toBe('boom');
    });
  });
});