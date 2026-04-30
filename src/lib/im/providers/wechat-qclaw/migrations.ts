/**
 * WeChat (QClaw) Provider — Settings Migration
 *
 * QClaw 是新增 provider，没有旧 settings 需要迁移。
 * 文件保留是为了维持所有 provider 同名同义结构（R3）；
 * 后续真有 schema 变更时在这里加版本化迁移。
 */

import { isMigrationApplied, markMigrationApplied } from '../../core/config-store';

const MIGRATION_VERSION = 'wechat-qclaw-init';

export function runWechatQclawMigrations(): void {
  if (isMigrationApplied(MIGRATION_VERSION)) return;
  markMigrationApplied(MIGRATION_VERSION);
}
