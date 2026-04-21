/**
 * Lumos Cloud 桌面端认证入口 — 登录态 + 登录→provision 总流程。
 *
 * 设计:
 *   - 与 lumos-web (`http://lumos.miki.zj.cn`) 登录, 拿到 new-api token key。
 *   - 登录成功后落地本地 "Lumos Cloud" provider, 以及可选的图片 provider。
 *   - provision 细节 (DB upsert / default fallback / 图片 provider 清理) 在
 *     `src/lib/cloud/provisioner.ts` 中, 本文件只持有内存中的 user 状态。
 */

import {
  CUSTOM_PROVIDER_CAPABILITIES,
  CUSTOM_PROVIDER_SETTING_KEYS,
  type CustomProviderFlags,
} from '@/lib/auth/custom-provider-capabilities';
import type { CloudUserInfo } from './cloud/types';
import {
  provisionCloudProvider,
  provisionImageProvider,
} from './cloud/provisioner';

const CLOUD_WEB_BASE = process.env.LUMOS_WEB_URL || 'http://lumos.miki.zj.cn';

export type {
  CloudImageProviderConfig,
  CloudImageProviderModel,
  CloudUserInfo,
} from './cloud/types';
export {
  ensureDefaultProviderFallback,
  provisionCloudProvider,
  provisionImageProvider,
} from './cloud/provisioner';

// ── 登录态 (进程内, 仅用于桌面端客户端) ──────────────────────────────────

let currentUser: CloudUserInfo | null = null;

export async function cloudLogin(account: string, password: string): Promise<CloudUserInfo> {
  const res = await fetch(`${CLOUD_WEB_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || '登录失败');
  currentUser = data.data;
  return data.data;
}

export function cloudLogout(): void {
  currentUser = null;
}

export function isCloudLoggedIn(): boolean {
  return currentUser !== null;
}

export function getCloudUser(): CloudUserInfo | null {
  return currentUser;
}

// ── 管控开关持久化 ────────────────────────────────────────────────────────

/**
 * 持久化 pro 版管理端下发的 "允许自定义 provider" 分能力开关。
 * 每个能力写一条 settings 行 ('1' / '0'), 便于 resolver 和 /api/auth/me 同步读取。
 */
export async function persistCustomProviderFlags(flags: Partial<CustomProviderFlags>): Promise<void> {
  const { getDb } = await import('@/lib/db/connection');
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const cap of CUSTOM_PROVIDER_CAPABILITIES) {
    stmt.run(CUSTOM_PROVIDER_SETTING_KEYS[cap], flags[cap] === true ? '1' : '0');
  }
}

// ── 登录 + provision 组合流程 ─────────────────────────────────────────────

/**
 * 完整登录:
 * 1. 向 lumos-web 登录
 * 2. 从用户 profile 拿 new-api token key
 * 3. provision 本地 Lumos Cloud provider (文本 + 可选图片)
 */
export async function cloudLoginAndProvision(
  account: string,
  password: string,
): Promise<{ user: CloudUserInfo; tokenKey: string; providerId: string }> {
  const user = await cloudLogin(account, password);

  if (!user.newapi_token_key) {
    throw new Error('账户未分配 API 令牌, 请联系管理员');
  }

  const tokenKey = `sk-${user.newapi_token_key}`;
  const providerId = await provisionCloudProvider(tokenKey);
  await provisionImageProvider(user.image_provider ?? null);

  return { user, tokenKey, providerId };
}
