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
import { packApp } from '../pack';
import type { ConsentCallback, InstallContext } from '../types';

const FIXTURES = path.join(__dirname, '../../manifest/__tests__/fixtures');

describe('packApp', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-pack-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('produces a zip from a valid app directory', async () => {
    const out = path.join(tmp, 'weekly.lumos-app');
    const result = await packApp(path.join(FIXTURES, 'valid-form-tool'), out);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fs.existsSync(out)).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(fs.readFileSync(out));
    expect(zip.file('app.json')).toBeTruthy();
    expect(zip.file('routes.json')).toBeTruthy();
    expect(zip.file('pages/main.json')).toBeTruthy();
  });

  it('refuses to pack an invalid manifest', async () => {
    const out = path.join(tmp, 'bad.lumos-app');
    const result = await packApp(path.join(FIXTURES, 'invalid-undeclared-workflow'), out);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.message.includes('Workflow not found'))).toBe(true);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('skips .DS_Store and node_modules', async () => {
    // Make a copy of the fixture and pollute it with junk.
    const stage = path.join(tmp, 'stage');
    fs.cpSync(path.join(FIXTURES, 'valid-form-tool'), stage, { recursive: true });
    fs.writeFileSync(path.join(stage, '.DS_Store'), 'macOS junk');
    fs.mkdirSync(path.join(stage, 'node_modules', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(stage, 'node_modules', 'lib', 'index.js'), '');

    const out = path.join(tmp, 'clean.lumos-app');
    const result = await packApp(stage, out);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const zip = await JSZip.loadAsync(fs.readFileSync(out));
    expect(zip.file('.DS_Store')).toBeNull();
    expect(zip.file('node_modules/lib/index.js')).toBeNull();
  });

  it('round-trips: pack then install', async () => {
    const out = path.join(tmp, 'app.lumos-app');
    const packed = await packApp(path.join(FIXTURES, 'valid-form-tool'), out);
    expect(packed.ok).toBe(true);

    // Install context
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateAppTables(db);
    const cryptor = createSoftwareCryptor(crypto.randomBytes(32));
    const vault = createSecretVault({ db, cryptor });
    const triggers = createTriggerManager(db);
    const grantAll: ConsentCallback = async (req) => ({
      granted: req.permissions.map((p) => p.permission),
    });
    const ctx: InstallContext = {
      db,
      vault,
      triggers,
      appsRootPath: path.join(tmp, 'apps'),
      onConsent: grantAll,
    };

    try {
      const result = await installApp({ type: 'zip', path: out }, ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(fs.existsSync(path.join(result.installed.installPath, 'app.json'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('returns an error when the source path is not a directory', async () => {
    const out = path.join(tmp, 'x.lumos-app');
    const result = await packApp(path.join(tmp, 'does-not-exist'), out);
    expect(result.ok).toBe(false);
  });
});
