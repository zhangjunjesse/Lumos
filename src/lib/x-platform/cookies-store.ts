/**
 * X 登录态 cookie 持久化。x.com web 鉴权依赖一组 cookies(主要 auth_token + ct0
 * + twid + guest_id), 我们写到 ~/.lumos/x-platform/cookies.json, 0o600 权限。
 *
 * 不和 goofish accounts 一样支持多账号:X 多账号需要独立浏览器 partition
 * (X anti-fraud 强), 当前单账号已经覆盖大部分场景。多账号留 v2。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface XStoredCookies {
  /** {[name]: value}, only the cookies x.com web actually needs. */
  cookies: Record<string, string>;
  /** unix ms when we last wrote them — used to age out stale tokens. */
  savedAt: number;
  /**
   * 用户登录时可选填写的元信息(@the-convocation 没暴露"按 user_id 反查
   * screen_name"的接口,只能让用户在 paste cookie 时一起填,或留空 fallback
   * 到 "用户 #userId")。
   */
  meta?: {
    screenName?: string;
    name?: string;
  };
}

const REQUIRED_NAMES = ['auth_token', 'ct0', 'twid'] as const;

function cookiesFile(): string {
  const dataDir = process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos');
  return path.join(dataDir, 'x-platform', 'cookies.json');
}

export function readCookies(): XStoredCookies | null {
  const file = cookiesFile();
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as XStoredCookies;
    if (!parsed?.cookies || typeof parsed.cookies !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCookies(
  cookies: Record<string, string>,
  meta?: { screenName?: string; name?: string },
): void {
  const file = cookiesFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const payload: XStoredCookies = { cookies, savedAt: Date.now() };
  const cleaned: { screenName?: string; name?: string } = {};
  if (meta?.screenName) cleaned.screenName = meta.screenName.trim().replace(/^@/, '');
  if (meta?.name) cleaned.name = meta.name.trim();
  if (cleaned.screenName || cleaned.name) payload.meta = cleaned;
  writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

export function clearCookies(): void {
  const file = cookiesFile();
  if (existsSync(file)) rmSync(file, { force: true });
}

export function hasRequiredCookies(cookies: Record<string, string> | undefined | null): boolean {
  if (!cookies) return false;
  return REQUIRED_NAMES.every((name) => Boolean(cookies[name]));
}

/**
 * twid cookie 形如 `u=1234567890`。提取数字部分作为 user id。
 */
export function userIdFromCookies(cookies: Record<string, string> | undefined | null): string {
  const raw = cookies?.twid || '';
  if (!raw) return '';
  // twid cookie 形如 `u=1234567890`,但浏览器复制粘贴时通常是 url-encoded
  // (`u%3D1234567890`)。两种形式都要兼容。
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* leave raw */ }
  const match = decoded.match(/u=(\d+)/);
  return match ? match[1] : '';
}

/** Build the `Cookie:` header string from the stored map. */
export function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .filter(([k, v]) => k && v)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}
