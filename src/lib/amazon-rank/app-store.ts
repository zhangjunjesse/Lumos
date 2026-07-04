import type Database from 'better-sqlite3';

import { BUILTIN_AMAZON_RANK_APP_ID } from '@/lib/app/amazon-rank-app-id';
import type { AppManifest } from '@/lib/app/manifest/types';
import { createAppDataStore, type AppDataStore } from '@/lib/app/runtime/data-store';
import { getAppPlatformService } from '@/lib/app/service';

export interface AmazonRankAppContext {
  db: Database.Database;
  store: AppDataStore;
  appId: string;
  installed: boolean;
  version: string | null;
  manifest: AppManifest | null;
}

/** API 路由统一入口：拿应用隔离数据仓 + 安装信息 + manifest */
export function getAmazonRankAppContext(): AmazonRankAppContext {
  const svc = getAppPlatformService();
  const row = svc.db
    .prepare('SELECT version, manifest_json FROM lumos_app_apps WHERE id = ?')
    .get(BUILTIN_AMAZON_RANK_APP_ID) as { version: string; manifest_json: string } | undefined;

  let manifest: AppManifest | null = null;
  if (row?.manifest_json) {
    try {
      manifest = JSON.parse(row.manifest_json) as AppManifest;
    } catch {
      manifest = null;
    }
  }

  return {
    db: svc.db,
    store: createAppDataStore(svc.db, BUILTIN_AMAZON_RANK_APP_ID),
    appId: BUILTIN_AMAZON_RANK_APP_ID,
    installed: !!row,
    version: row?.version ?? null,
    manifest,
  };
}
