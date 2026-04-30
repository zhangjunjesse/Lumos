import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';

import { migrateAppTables } from '../../../db/migrations-app';
import { createSoftwareCryptor } from '../../runtime/secret-cryptor';
import { createSecretVault } from '../../runtime/secret-vault';
import { createTriggerManager } from '../../runtime/trigger-manager';

import { installApp } from '../install';
import type { ConsentCallback, InstallContext, UninstallContext } from '../types';
import { uninstallApp } from '../uninstall';

const FIXTURES = path.join(__dirname, '../../manifest/__tests__/fixtures');
const VALID_FORM_TOOL = path.join(FIXTURES, 'valid-form-tool');

function makeCtx(): {
  installCtx: InstallContext;
  uninstallCtx: UninstallContext;
  appsRoot: string;
  cleanup: () => void;
} {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-uninst-'));
  const appsRoot = path.join(tmp, 'apps');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  const cryptor = createSoftwareCryptor(crypto.randomBytes(32));
  const vault = createSecretVault({ db, cryptor });
  const triggers = createTriggerManager(db);
  const grantAll: ConsentCallback = async (req) => ({
    granted: req.permissions.map((p) => p.permission),
  });
  const installCtx: InstallContext = {
    db, vault, triggers, appsRootPath: appsRoot, onConsent: grantAll,
  };
  return {
    installCtx,
    uninstallCtx: { db, vault, triggers, appsRootPath: appsRoot },
    appsRoot,
    cleanup: () => {
      try { db.close(); } catch { /* ignore */ }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

describe('uninstallApp', () => {
  it('returns NotInstalled if the app id is unknown', async () => {
    const { uninstallCtx, cleanup } = makeCtx();
    try {
      const result = await uninstallApp('does-not-exist', uninstallCtx);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('NotInstalled');
    } finally {
      cleanup();
    }
  });

  it('removes the install dir and cascades configs/permissions', async () => {
    const { installCtx, uninstallCtx, cleanup } = makeCtx();
    try {
      const installed = await installApp(
        { type: 'directory', path: VALID_FORM_TOOL },
        installCtx,
      );
      expect(installed.ok).toBe(true);
      if (!installed.ok) return;

      installCtx.vault.set('weekly-summary', 'token', 'X', { secret: true });

      const result = await uninstallApp('weekly-summary', uninstallCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.appId).toBe('weekly-summary');
      expect(fs.existsSync(installed.installed.installPath)).toBe(false);

      // App row gone
      expect(uninstallCtx.db.prepare('SELECT id FROM lumos_app_apps WHERE id=?').get('weekly-summary')).toBeUndefined();
      // Configs gone (CASCADE)
      expect(installCtx.vault.list('weekly-summary')).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('keeps user data by default (keepData=true)', async () => {
    const { installCtx, uninstallCtx, cleanup } = makeCtx();
    try {
      const installed = await installApp(
        { type: 'directory', path: VALID_FORM_TOOL },
        installCtx,
      );
      expect(installed.ok).toBe(true);

      uninstallCtx.db.prepare(
        `INSERT INTO lumos_app_data (app_id, collection, id, data_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('weekly-summary', 'reports', 'r1', '{}', Date.now(), Date.now());

      const result = await uninstallApp('weekly-summary', uninstallCtx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.deletedDataRows).toBe(0);

      const survivors = uninstallCtx.db
        .prepare('SELECT COUNT(*) AS c FROM lumos_app_data WHERE app_id = ?')
        .get('weekly-summary') as { c: number };
      expect(survivors.c).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('purges user data when keepData=false', async () => {
    const { installCtx, uninstallCtx, cleanup } = makeCtx();
    try {
      const installed = await installApp(
        { type: 'directory', path: VALID_FORM_TOOL },
        installCtx,
      );
      expect(installed.ok).toBe(true);

      uninstallCtx.db.prepare(
        `INSERT INTO lumos_app_data (app_id, collection, id, data_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
      ).run(
        'weekly-summary', 'reports', 'r1', '{}', Date.now(), Date.now(),
        'weekly-summary', 'reports', 'r2', '{}', Date.now(), Date.now(),
      );

      const result = await uninstallApp('weekly-summary', uninstallCtx, { keepData: false });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.deletedDataRows).toBe(2);

      const survivors = uninstallCtx.db
        .prepare('SELECT COUNT(*) AS c FROM lumos_app_data WHERE app_id = ?')
        .get('weekly-summary') as { c: number };
      expect(survivors.c).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('removes the previous-version dir when purgePrevious is true (default)', async () => {
    const { installCtx, uninstallCtx, cleanup } = makeCtx();
    try {
      // Install v1
      const v1 = await installApp({ type: 'directory', path: VALID_FORM_TOOL }, installCtx);
      expect(v1.ok).toBe(true);

      // Stage v2 and install
      const v2Stage = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-v2-'));
      try {
        for (const entry of fs.readdirSync(VALID_FORM_TOOL, { withFileTypes: true })) {
          const src = path.join(VALID_FORM_TOOL, entry.name);
          const dest = path.join(v2Stage, entry.name);
          if (entry.isDirectory()) fs.cpSync(src, dest, { recursive: true });
          else fs.copyFileSync(src, dest);
        }
        const m = JSON.parse(fs.readFileSync(path.join(v2Stage, 'app.json'), 'utf-8')) as { version: string };
        m.version = '2.0.0';
        fs.writeFileSync(path.join(v2Stage, 'app.json'), JSON.stringify(m));

        const v2 = await installApp({ type: 'directory', path: v2Stage }, installCtx);
        expect(v2.ok).toBe(true);
        if (!v2.ok) return;
        const prevPath = (v1.ok && v1.installed.installPath) || '';
        expect(fs.existsSync(prevPath)).toBe(true);

        const result = await uninstallApp('weekly-summary', uninstallCtx);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(fs.existsSync(prevPath)).toBe(false);
      } finally {
        fs.rmSync(v2Stage, { recursive: true, force: true });
      }
    } finally {
      cleanup();
    }
  });
});
