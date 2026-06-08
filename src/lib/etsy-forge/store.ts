// Etsy Forge — store helpers for API routes
// 集中拿 AppDataStore + userId，避免每个 route 重复样板。

import type { NextRequest } from 'next/server';
import { createAppDataStore, type AppDataStore } from '@/lib/app/runtime/data-store';
import { getAppPlatformService } from '@/lib/app/service';
import { validateSession } from '@/lib/auth/session';

export const ETSY_FORGE_APP_ID = 'etsy-forge';

export function getEtsyForgeStore(): AppDataStore {
  const svc = getAppPlatformService();
  return createAppDataStore(svc.db, ETSY_FORGE_APP_ID);
}

/**
 * 真实 Lumos Cloud userId（用于走中心计费 consumeRemoteQuota）。
 * 未登录返回 undefined —— image-gen-tool 看到 undefined 就跳过 quota，
 * 直接走 provider 本地 API（不扣云端配额）。
 *
 * **绝对不要** fallback 到一个 fake string（之前的 'lumos-local-user' bug）—— 那会让
 * image-gen-billing 去查 lumos_users 表找不到，必抛 "未登录 Lumos 云账户"。
 */
export function getCloudUserId(req: NextRequest): string | undefined {
  const token = req.cookies.get('lumos_session')?.value;
  if (!token) return undefined;
  return validateSession(token)?.id;
}

/**
 * 业务隔离用 userId（图库 / 审美档案 / 运行记录的 user_id 字段）。
 *
 * **决策（2026-05-28）**: 桌面单机 Electron 应用 → 永远返回 'local'，不跟随 cookie 飘移。
 *
 * 之前的设计是「登录返回真实 cloud userId / 没登录返回 'local'」——但这会让默认 evergreen
 * 任务（ensureEtsyForgeDefaultAutomations 注入时 user_id='local'）对登录用户不可见，链路
 * 全断（listTasks 查不到 → run-now 403 → recommendFromPool 池子空）。
 *
 * 多用户隔离对桌面 Electron 是过度设计；未来真要做 multi-user 时再扩展。
 *
 * `req` 参数保留用于将来扩展（按 chat history / per-team / per-edition 等维度隔离），现在不读。
 */
// 业务隔离 userId(桌面单机恒 'local',见上决策)。没有 request 的场景(agent 工具/连接器)用这个。
export function getEtsyForgeUserId(): string {
  return 'local';
}

export function getStorageUserId(_req: NextRequest): string {
  return getEtsyForgeUserId();
}

/** 采集用浏览器上下文（设置→采集浏览器选）。默认内置浏览器；要 EHunt 选 adspower:xxx。 */
export function getBrowserContextId(store: AppDataStore): string {
  const row = store.query<{ browser_context_id?: string }>('app_settings', { limit: 1 })[0];
  return (row?.browser_context_id ?? '').trim() || 'embedded:default';
}

// 浏览器步全局串行锁键:采详情 / 采店铺 / 重采店铺都驱动同一个 AdsPower 连接,必须串行,否则并发会互相关连接。
export const BROWSER_STEP_LOCK = 'etsy-forge:detail-browser';
