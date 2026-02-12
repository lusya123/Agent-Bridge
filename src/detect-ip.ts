import { log } from './logger.js';

const IP_SERVICES = [
  'https://api.ipify.org',
  'https://ifconfig.me/ip',
  'https://icanhazip.com',
];

/** Detect public IP by querying external services. Returns null if detection fails. */
export async function detectPublicIp(): Promise<string | null> {
  for (const url of IP_SERVICES) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const ip = (await res.text()).trim();
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
          log.info('IP', `Detected public IP: ${ip}`);
          return ip;
        }
      }
    } catch {
      // try next service
    }
  }
  log.warn('IP', 'Could not detect public IP');
  return null;
}
