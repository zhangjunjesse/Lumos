import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface GoofishCookieItem {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

const TAOBAO_COOKIE_NAMES = new Set(['_m_h5_tk', '_m_h5_tk_enc', 'x5sec', 'sgcookie', 'cookie2', '_tb_token_']);

export function parseCookieHeader(raw: string): GoofishCookieItem[] {
  const expires = Math.floor(Date.now() / 1000) + 30 * 86400;
  const out: GoofishCookieItem[] = [];
  const cookieHeader = extractCookieHeaderValue(raw);
  for (const kv of cookieHeader.split(';')) {
    const trimmed = kv.trim();
    if (!trimmed || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!name) continue;
    out.push({
      name,
      value,
      domain: cookieDomainForName(name),
      path: '/',
      expires,
      httpOnly: false,
      secure: true,
      sameSite: 'no_restriction',
    });
  }
  return out;
}

function extractCookieHeaderValue(raw: string): string {
  const cookieLine = raw.split(/\r?\n/).find((line) => /^\s*cookie\s*:/i.test(line));
  return (cookieLine ?? raw).replace(/^\s*cookie\s*:\s*/i, '');
}

export function cookieValue(items: GoofishCookieItem[], name: string): string {
  return items.find((item) => item.name === name && item.value)?.value ?? '';
}

export function cookieDomainForName(name: string): string {
  return TAOBAO_COOKIE_NAMES.has(name) ? '.taobao.com' : '.goofish.com';
}

export function cookieItemsToRecord(items: GoofishCookieItem[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) {
    if (item.name && item.value) {
      out[item.name] = item.value;
    }
  }
  return out;
}

export function cookieRecordToItems(cookies: Record<string, string>): GoofishCookieItem[] {
  return Object.entries(cookies)
    .filter(([name, value]) => Boolean(name) && Boolean(value))
    .map(([name, value]) => ({ name, value }));
}

export function readCookieItems(cookiesPath: string): GoofishCookieItem[] {
  const raw = JSON.parse(readFileSync(cookiesPath, 'utf-8')) as unknown;
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .filter((item) => typeof item.name === 'string' && item.value !== undefined && item.value !== null)
      .map((item) => ({
        ...item,
        name: item.name as string,
        value: String(item.value),
      }));
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([name, value]) => Boolean(name) && typeof value !== 'undefined' && value !== null)
      .map(([name, value]) => ({ name, value: String(value) }));
  }
  return [];
}

export function readCookieRecord(cookiesPath: string): Record<string, string> {
  return cookieItemsToRecord(readCookieItems(cookiesPath));
}

export function readUnbFromCookies(cookiesPath: string): string {
  try {
    return cookieValue(readCookieItems(cookiesPath), 'unb');
  } catch {
    return '';
  }
}

export function writeCookieItems(cookiesPath: string, items: GoofishCookieItem[]): void {
  mkdirSync(path.dirname(cookiesPath), { recursive: true });
  writeFileSync(cookiesPath, JSON.stringify(items, null, 2), { mode: 0o600 });
}

export function writeCookieRecord(cookiesPath: string, cookies: Record<string, string>): void {
  writeCookieItems(cookiesPath, cookieRecordToItems(cookies));
}

export function copyCookieFile(sourcePath: string, targetPath: string): boolean {
  if (!existsSync(sourcePath)) return false;
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, readFileSync(sourcePath), { mode: 0o600 });
  return true;
}

export function copyLoginResultCookiesToTarget(result: unknown, targetPath: string): boolean {
  if (existsSync(targetPath)) return true;
  if (!result || typeof result !== 'object' || !('path' in result)) return false;
  const sourcePath = (result as { path?: unknown }).path;
  if (typeof sourcePath !== 'string' || !sourcePath) return false;
  return copyCookieFile(sourcePath, targetPath);
}
