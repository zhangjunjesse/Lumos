/**
 * WeChat Work Provider — Settings Migration (placeholder)
 */

import { isMigrationApplied, markMigrationApplied } from '../../core/config-store';

const MIGRATION_VERSION = 'wechat-work-init';

export function runWechatWorkMigrations(): void {
  if (isMigrationApplied(MIGRATION_VERSION)) return;
  markMigrationApplied(MIGRATION_VERSION);
}
