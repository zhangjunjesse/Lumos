import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';

import { installApp } from '../installer/install';
import type { ConsentCallback, InstallContext } from '../installer/types';
import { validateNativeAppPackageDirectory } from '../native-app-package-validation';
import { createSoftwareCryptor } from '../runtime/secret-cryptor';
import { createSecretVault } from '../runtime/secret-vault';
import { createTriggerManager } from '../runtime/trigger-manager';

const APP_DIR = path.resolve(__dirname, '../../../../apps/amazon-rank');

function makeCtx(): { ctx: InstallContext; cleanup: () => void } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-amazon-rank-install-'));
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  const cryptor = createSoftwareCryptor(crypto.randomBytes(32));
  const vault = createSecretVault({ db, cryptor });
  const triggers = createTriggerManager(db);
  const grantAll: ConsentCallback = async (req) => ({
    granted: req.permissions.map((p) => p.permission),
  });
  return {
    ctx: { db, vault, triggers, appsRootPath: path.join(tmp, 'apps'), onConsent: grantAll },
    cleanup: () => {
      try { db.close(); } catch { /* ignore */ }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

describe('apps/amazon-rank 应用包', () => {
  it('通过内置级应用包门禁', () => {
    const result = validateNativeAppPackageDirectory(APP_DIR);
    expect(result.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('能通过真实安装链完整安装（ajv schema + 权限 + 落库）', async () => {
    const { ctx, cleanup } = makeCtx();
    try {
      const result = await installApp({ type: 'directory', path: APP_DIR }, ctx, { source: 'local' });
      if (!result.ok) {
        throw new Error(`安装失败: ${result.message}\n${JSON.stringify(result.issues ?? [], null, 1)}`);
      }
      expect(result.installed.appId).toBe('amazon-rank');
      expect(result.installed.version).toBe('0.1.0');

      const row = ctx.db
        .prepare('SELECT id, version FROM lumos_app_apps WHERE id = ?')
        .get('amazon-rank') as { id: string; version: string } | undefined;
      expect(row?.version).toBe('0.1.0');
    } finally {
      cleanup();
    }
  });
});
