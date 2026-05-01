/**
 * WeChat Provider — Settings Migration
 *
 * 老的 wechat-qclaw 配置 key 在 settings 里可能还残留（host/bot_id/bot_secret/transport
 * /send_path/events_path/contacts_path/health_path）。一次性删掉，避免误读。
 * Token 留给用户重新扫码绑定。
 */

import { getSetting, setSetting } from '@/lib/db';
import { isMigrationApplied, markMigrationApplied } from '../../core/config-store';

const MIGRATION_VERSION = 'wechat-ilink-rewrite-2026-04';

const STALE_KEYS = [
  'im.wechat-qclaw.qclaw_host',
  'im.wechat-qclaw.bot_id',
  'im.wechat-qclaw.bot_secret',
  'im.wechat-qclaw.transport',
  'im.wechat-qclaw.send_path',
  'im.wechat-qclaw.events_path',
  'im.wechat-qclaw.contacts_path',
  'im.wechat-qclaw.health_path',
];

export function runWechatMigrations(): void {
  if (isMigrationApplied(MIGRATION_VERSION)) return;
  for (const key of STALE_KEYS) {
    if (getSetting(key)) setSetting(key, '');
  }
  markMigrationApplied(MIGRATION_VERSION);
}
