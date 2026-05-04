/**
 * Feishu Provider — Settings Migration
 *
 * 一次性把旧的扁平 settings key 复制到新的 im.feishu.* 命名空间。
 * 旧 key 不删，旧代码路径仍可工作，避免回退困难。
 *
 * 在 index.ts (registerPlugin 之后) 调用一次即可，幂等。
 */

import { getSetting } from '@/lib/db';
import {
  isMigrationApplied,
  markMigrationApplied,
  setProviderField,
} from '../../core/config-store';

const MIGRATION_VERSION = 'feishu-2026-04-01';

interface LegacyKeyMapping {
  legacy: string;
  field: string;
}

const MAPPINGS: LegacyKeyMapping[] = [
  { legacy: 'feishu_app_id', field: 'app_id' },
  { legacy: 'feishu_app_secret', field: 'app_secret' },
  { legacy: 'feishu_redirect_uri', field: 'redirect_uri' },
  { legacy: 'feishu_oauth_scopes', field: 'oauth_scopes' },
];

export function runFeishuMigrations(): void {
  if (isMigrationApplied(MIGRATION_VERSION)) return;

  for (const { legacy, field } of MAPPINGS) {
    const value = getSetting(legacy);
    if (value && value.trim()) {
      setProviderField('feishu', field, value);
    }
  }

  markMigrationApplied(MIGRATION_VERSION);
}
