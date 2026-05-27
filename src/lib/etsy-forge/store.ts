// Etsy Forge — store helpers for API routes
// 集中拿 AppDataStore + userId，避免每个 route 重复样板。

import { createAppDataStore, type AppDataStore } from '@/lib/app/runtime/data-store';
import { getAppPlatformService } from '@/lib/app/service';

export const ETSY_FORGE_APP_ID = 'etsy-forge';

export function getEtsyForgeStore(): AppDataStore {
  const svc = getAppPlatformService();
  return createAppDataStore(svc.db, ETSY_FORGE_APP_ID);
}

/**
 * MVP: Lumos 桌面端单用户。
 * 后续如果接入 Lumos Cloud 登录，应从 session 拿真实 userId。
 * userId 决定是否走中心配额扣减（resolveBillingTarget → consumeRemoteQuota）。
 */
export function getCurrentUserId(): string {
  return process.env.LUMOS_USER_ID || 'lumos-local-user';
}
