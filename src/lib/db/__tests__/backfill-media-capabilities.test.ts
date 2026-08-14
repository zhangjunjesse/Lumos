// issue #64 存量修复:能力默认映射曾漏掉媒体类型,手建的 midjourney / openai-image
// 服务商落库时 capabilities 被盖成 '["text-gen"]',按名字指定出图服务商永远匹配不到。
// 回填只重写「媒体类型 + 错误产物值」的行,不碰用户显式配置。

import Database from 'better-sqlite3';
import { backfillMediaProviderCapabilities } from '../migrations-lumos';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE api_providers (
      id TEXT PRIMARY KEY,
      provider_type TEXT NOT NULL,
      capabilities TEXT NOT NULL DEFAULT '["text-gen"]'
    );
  `);
  return db;
}

function caps(db: Database.Database, id: string): string {
  return (db.prepare('SELECT capabilities FROM api_providers WHERE id = ?').get(id) as { capabilities: string }).capabilities;
}

describe('backfillMediaProviderCapabilities (#64)', () => {
  it('修正被误标成 text-gen 的媒体服务商;不碰聊天服务商与显式配置', () => {
    const db = makeDb();
    db.exec(`
      INSERT INTO api_providers (id, provider_type, capabilities) VALUES
        ('mj-broken',   'midjourney',   '["text-gen"]'),
        ('oai-broken',  'openai-image', ''),
        ('asr-broken',  'volcengine-asr-v1', '[]'),
        ('mj-custom',   'midjourney',   '["image-gen","text-gen"]'),
        ('chat-ok',     'anthropic',    '["text-gen"]');
    `);

    backfillMediaProviderCapabilities(db);

    expect(caps(db, 'mj-broken')).toBe('["image-gen"]');
    expect(caps(db, 'oai-broken')).toBe('["image-gen"]');
    expect(caps(db, 'asr-broken')).toBe('["speech"]');
    // 用户显式配置(非错误产物值)原样保留
    expect(caps(db, 'mj-custom')).toBe('["image-gen","text-gen"]');
    // 聊天服务商的 text-gen 是正确值,不动
    expect(caps(db, 'chat-ok')).toBe('["text-gen"]');
  });

  it('幂等:跑两次结果一致', () => {
    const db = makeDb();
    db.exec("INSERT INTO api_providers (id, provider_type, capabilities) VALUES ('mj', 'midjourney', '[\"text-gen\"]')");
    backfillMediaProviderCapabilities(db);
    backfillMediaProviderCapabilities(db);
    expect(caps(db, 'mj')).toBe('["image-gen"]');
  });
});
