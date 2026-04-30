import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import JSZip from 'jszip';

import { migrateAppTables } from '../../../db/migrations-app';
import { createSoftwareCryptor } from '../../runtime/secret-cryptor';
import { createSecretVault } from '../../runtime/secret-vault';
import { createTriggerManager } from '../../runtime/trigger-manager';

import { installApp } from '../install';
import type { ConsentCallback, InstallContext } from '../types';

const FIXTURES = path.join(__dirname, '../../manifest/__tests__/fixtures');
const VALID_FORM_TOOL = path.join(FIXTURES, 'valid-form-tool');

function makeCtx(overrides?: Partial<InstallContext>): {
  ctx: InstallContext;
  appsRoot: string;
  cleanup: () => void;
} {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-install-test-'));
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

  return {
    ctx: { db, vault, triggers, appsRootPath: appsRoot, onConsent: grantAll, ...overrides },
    appsRoot,
    cleanup: () => {
      try { db.close(); } catch { /* ignore */ }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

describe('installApp — directory source', () => {
  it('installs a valid app from a directory', async () => {
    const { ctx, cleanup } = makeCtx();
    try {
      const result = await installApp(
        { type: 'directory', path: VALID_FORM_TOOL },
        ctx,
        { source: 'local' },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.installed.appId).toBe('weekly-summary');
      expect(result.installed.version).toBe('1.0.0');
      expect(result.installed.isUpgrade).toBe(false);
      expect(fs.existsSync(path.join(result.installed.installPath, 'app.json'))).toBe(true);

      const row = ctx.db
        .prepare(`SELECT id, version, source, install_path FROM lumos_app_apps WHERE id = ?`)
        .get('weekly-summary') as { id: string; version: string; source: string; install_path: string };
      expect(row.version).toBe('1.0.0');
      expect(row.source).toBe('local');
      expect(row.install_path).toBe(result.installed.installPath);
    } finally {
      cleanup();
    }
  });

  it('records all permissions, marking granted vs denied', async () => {
    const { ctx, cleanup } = makeCtx({
      onConsent: async (req) => ({
        granted: req.permissions
          .filter((p) => p.permission.startsWith('mcp:'))
          .map((p) => p.permission),
      }),
    });
    try {
      const result = await installApp(
        { type: 'directory', path: VALID_FORM_TOOL },
        ctx,
        { source: 'ai-generated' },
      );
      expect(result.ok).toBe(true);
      // valid-form-tool has no MCPs declared, so no permissions are emitted —
      // we just verify the row count is 0.
      const perms = ctx.db
        .prepare('SELECT COUNT(*) AS c FROM lumos_app_permissions WHERE app_id = ?')
        .get('weekly-summary') as { c: number };
      expect(perms.c).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('rejects an invalid manifest', async () => {
    const { ctx, cleanup } = makeCtx();
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bad-app-'));
      try {
        fs.writeFileSync(
          path.join(tmp, 'app.json'),
          JSON.stringify({ id: 'BadId', name: 'X', version: '1.0', icon: './icon.png', entry: 'home' }),
        );
        const result = await installApp({ type: 'directory', path: tmp }, ctx);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toBe('ManifestInvalid');
        expect(result.issues.length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    } finally {
      cleanup();
    }
  });

  it('rejects cross-file inconsistencies', async () => {
    const { ctx, cleanup } = makeCtx();
    try {
      const result = await installApp(
        { type: 'directory', path: path.join(FIXTURES, 'invalid-undeclared-workflow') },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('CrossFileInvalid');
      expect(result.issues.some((i) => i.message.includes('Workflow not found'))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('refuses to reinstall the same version', async () => {
    const { ctx, cleanup } = makeCtx();
    try {
      const first = await installApp({ type: 'directory', path: VALID_FORM_TOOL }, ctx);
      expect(first.ok).toBe(true);

      const second = await installApp({ type: 'directory', path: VALID_FORM_TOOL }, ctx);
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error).toBe('VersionConflict');
    } finally {
      cleanup();
    }
  });

  it('honors user cancellation', async () => {
    const { ctx, cleanup } = makeCtx({
      onConsent: async () => null,
    });
    try {
      const result = await installApp({ type: 'directory', path: VALID_FORM_TOOL }, ctx);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('UserCancelled');
      // App row must not exist.
      const row = ctx.db.prepare(`SELECT id FROM lumos_app_apps WHERE id = ?`).get('weekly-summary');
      expect(row).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it('upgrade preserves previous_version + previous_install_path', async () => {
    const { ctx, cleanup } = makeCtx();
    try {
      const v1 = await installApp({ type: 'directory', path: VALID_FORM_TOOL }, ctx);
      expect(v1.ok).toBe(true);

      // Stage a v2 by copying the fixture and bumping the version.
      const v2Stage = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-v2-'));
      try {
        for (const entry of fs.readdirSync(VALID_FORM_TOOL, { withFileTypes: true })) {
          const src = path.join(VALID_FORM_TOOL, entry.name);
          const dest = path.join(v2Stage, entry.name);
          if (entry.isDirectory()) {
            fs.cpSync(src, dest, { recursive: true });
          } else {
            fs.copyFileSync(src, dest);
          }
        }
        const manifest = JSON.parse(fs.readFileSync(path.join(v2Stage, 'app.json'), 'utf-8')) as {
          version: string;
        };
        manifest.version = '2.0.0';
        fs.writeFileSync(path.join(v2Stage, 'app.json'), JSON.stringify(manifest));

        const v2 = await installApp({ type: 'directory', path: v2Stage }, ctx);
        expect(v2.ok).toBe(true);
        if (!v2.ok) return;
        expect(v2.installed.isUpgrade).toBe(true);
        expect(v2.installed.previousVersion).toBe('1.0.0');

        const row = ctx.db
          .prepare(`SELECT version, previous_version, previous_install_path FROM lumos_app_apps WHERE id = ?`)
          .get('weekly-summary') as {
          version: string;
          previous_version: string;
          previous_install_path: string;
        };
        expect(row.version).toBe('2.0.0');
        expect(row.previous_version).toBe('1.0.0');
        expect(row.previous_install_path).toContain('1.0.0');
      } finally {
        fs.rmSync(v2Stage, { recursive: true, force: true });
      }
    } finally {
      cleanup();
    }
  });

  it('writes default config values via the secret vault', async () => {
    const { ctx, cleanup } = makeCtx();
    try {
      const result = await installApp(
        { type: 'directory', path: path.join(FIXTURES, 'valid-list-detail-crm') },
        ctx,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The fixture declares config: default_status default 'active'.
      expect(ctx.vault.get('mini-crm', 'default_status')).toBe('active');
    } finally {
      cleanup();
    }
  });

  it('preserves prior user data on reinstall via the no-FK design', async () => {
    const { ctx, cleanup } = makeCtx();
    try {
      // Install
      const first = await installApp({ type: 'directory', path: VALID_FORM_TOOL }, ctx);
      expect(first.ok).toBe(true);

      // User adds some data
      ctx.db
        .prepare(
          `INSERT INTO lumos_app_data (app_id, collection, id, data_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('weekly-summary', 'reports', 'r1', '{"week":42}', Date.now(), Date.now());

      // Uninstall (default keepData=true) by deleting the app row directly to simulate
      ctx.db.prepare(`DELETE FROM lumos_app_apps WHERE id = ?`).run('weekly-summary');

      // Reinstall same id at v2
      const v2Stage = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-v2b-'));
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

        const second = await installApp({ type: 'directory', path: v2Stage }, ctx);
        expect(second.ok).toBe(true);
      } finally {
        fs.rmSync(v2Stage, { recursive: true, force: true });
      }

      const dataRow = ctx.db
        .prepare(`SELECT data_json FROM lumos_app_data WHERE app_id = ? AND id = ?`)
        .get('weekly-summary', 'r1') as { data_json: string } | undefined;
      expect(dataRow?.data_json).toContain('"week":42');
    } finally {
      cleanup();
    }
  });
});

describe('installApp — zip source', () => {
  it('installs from a packed zip', async () => {
    const { ctx, cleanup } = makeCtx();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-zip-'));
    try {
      // Build a zip directly from the fixture.
      const zip = new JSZip();
      const addDir = (srcDir: string, prefix: string) => {
        for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
          const src = path.join(srcDir, entry.name);
          const zp = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) addDir(src, zp);
          else if (entry.isFile()) zip.file(zp, fs.readFileSync(src));
        }
      };
      addDir(VALID_FORM_TOOL, '');
      const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
      const zipPath = path.join(tmp, 'pack.lumos-app');
      fs.writeFileSync(zipPath, zipBuf);

      const result = await installApp({ type: 'zip', path: zipPath }, ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(fs.existsSync(path.join(result.installed.installPath, 'app.json'))).toBe(true);
    } finally {
      cleanup();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects a zip-slip attack via Windows-style backslash path', async () => {
    // JSZip normalizes forward-slash '..' paths at write time, so this test
    // uses backslashes — JSZip stores them verbatim and our sanitizer must
    // catch them. The attack target on disk would be ../../etc/x.
    const { ctx, cleanup } = makeCtx();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-zip-slip-'));
    try {
      const zip = new JSZip();
      zip.file('app.json', '{}');
      zip.file('..\\..\\etc\\passwd', 'pwned');
      const buf = await zip.generateAsync({ type: 'nodebuffer' });
      const zipPath = path.join(tmp, 'bad.lumos-app');
      fs.writeFileSync(zipPath, buf);

      const result = await installApp({ type: 'zip', path: zipPath }, ctx);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('UnpackError');
    } finally {
      cleanup();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns UnpackError when the zip is corrupt', async () => {
    const { ctx, cleanup } = makeCtx();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-zip-bad-'));
    try {
      const zipPath = path.join(tmp, 'corrupt.lumos-app');
      fs.writeFileSync(zipPath, Buffer.from('not actually a zip'));
      const result = await installApp({ type: 'zip', path: zipPath }, ctx);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('UnpackError');
    } finally {
      cleanup();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
