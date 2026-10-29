// Адрес и браузер клиента для журнала входов и списка сеансов (v0.6.0).
import type { Request } from 'express';

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

/** Адрес — req.ip с учётом trust proxy (app.setup.ts); строка браузера — до 300 символов. */
export function clientInfo(req: Pick<Request, 'ip' | 'headers'> & { socket?: { remoteAddress?: string } }): ClientInfo {
  const ua = req.headers['user-agent'];
  return {
    ip: req.ip ?? req.socket?.remoteAddress ?? undefined,
    userAgent: typeof ua === 'string' && ua ? ua.slice(0, 300) : undefined,
  };
}

const BROWSERS: Array<[RegExp, string]> = [
  [/YaBrowser\/(\d+)/, 'Яндекс Браузер'],
  [/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/Firefox\/(\d+)/, 'Firefox'],
  [/Chrome\/(\d+)/, 'Chrome'],
  [/Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari/, 'Safari'],
];

const SYSTEMS: Array<[RegExp, string]> = [
  [/Windows NT/, 'Windows'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

/** «Chrome 130 · Windows» — для списка сеансов; без строки браузера — «Неизвестное устройство». */
export function describeAgent(ua: string | null | undefined): string {
  if (!ua) return 'Неизвестное устройство';
  let browser = '';
  for (const [re, name] of BROWSERS) {
    const m = re.exec(ua);
    if (m) { browser = `${name} ${m[1]}`; break; }
  }
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? '';
  return [browser, system].filter(Boolean).join(' · ') || 'Неизвестное устройство';
}
