import crypto from 'crypto';

import Database from 'better-sqlite3';

import { migrateAppTables } from '../../../db/migrations-app';
import { createSoftwareCryptor } from '../secret-cryptor';
import { createSecretVault } from '../secret-vault';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  // Register two apps so FKs are satisfied.
  const now = Date.now();
  for (const id of ['app-one', 'app-two']) {
    db.prepare(
      `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, id, '1.0.0', '{}', 'ai-generated', `/tmp/${id}`, now);
  }
  const cryptor = createSoftwareCryptor(crypto.randomBytes(32));
  const vault = createSecretVault({ db, cryptor });
  return { db, cryptor, vault };
}

describe('SecretVault — basic CRUD', () => {
  it('stores and reads a secret', () => {
    const { vault } = setup();
    vault.set('app-one', 'feishu_token', 'lark-app-abc-secret', { secret: true });
    expect(vault.get('app-one', 'feishu_token')).toBe('lark-app-abc-secret');
  });

  it('stores and reads a non-secret config', () => {
    const { vault } = setup();
    vault.set('app-one', 'default_status', 'active');
    expect(vault.get('app-one', 'default_status')).toBe('active');
  });

  it('returns null for missing key', () => {
    const { vault } = setup();
    expect(vault.get('app-one', 'nonexistent')).toBeNull();
  });

  it('upserts (re-set) the same key', () => {
    const { vault } = setup();
    vault.set('app-one', 'k', 'v1');
    vault.set('app-one', 'k', 'v2');
    expect(vault.get('app-one', 'k')).toBe('v2');
    const list = vault.list('app-one');
    expect(list).toHaveLength(1);
  });

  it('deletes a key', () => {
    const { vault } = setup();
    vault.set('app-one', 'k', 'v');
    expect(vault.delete('app-one', 'k')).toBe(true);
    expect(vault.delete('app-one', 'k')).toBe(false);
    expect(vault.get('app-one', 'k')).toBeNull();
  });

  it('clearAll removes all rows for an app and returns the count', () => {
    const { vault } = setup();
    vault.set('app-one', 'a', '1');
    vault.set('app-one', 'b', '2');
    vault.set('app-two', 'c', '3');
    expect(vault.clearAll('app-one')).toBe(2);
    expect(vault.list('app-one')).toEqual([]);
    expect(vault.get('app-two', 'c')).toBe('3');
  });
});

describe('SecretVault — encryption at rest', () => {
  it('on-disk row never contains the plaintext', () => {
    const { db, vault } = setup();
    vault.set('app-one', 'token', 'PLAINTEXT-MARKER-XYZ');
    const row = db
      .prepare(
        `SELECT value_encrypted FROM lumos_app_configs WHERE app_id = ? AND key = ?`,
      )
      .get('app-one', 'token') as { value_encrypted: string };
    expect(row.value_encrypted).not.toContain('PLAINTEXT-MARKER-XYZ');
    expect(row.value_encrypted).toMatch(/^[A-Za-z0-9+/=]+$/); // base64
  });

  it('non-secret values are also encrypted', () => {
    const { db, vault } = setup();
    vault.set('app-one', 'username', 'alice', { secret: false });
    const row = db
      .prepare(
        `SELECT value_encrypted FROM lumos_app_configs WHERE app_id = ? AND key = ?`,
      )
      .get('app-one', 'username') as { value_encrypted: string };
    expect(row.value_encrypted).not.toContain('alice');
  });
});

describe('SecretVault — list and resolveAll', () => {
  it('list returns metadata only (never decrypts)', () => {
    const { vault } = setup();
    vault.set('app-one', 'a', 'AAA', { secret: true });
    vault.set('app-one', 'b', 'BBB', { secret: false });
    const meta = vault.list('app-one');
    expect(meta).toEqual([
      expect.objectContaining({ key: 'a', isSecret: true }),
      expect.objectContaining({ key: 'b', isSecret: false }),
    ]);
    // Metadata has no `value` field.
    expect((meta[0] as Record<string, unknown>).value).toBeUndefined();
  });

  it('resolveAll returns every value decrypted as a flat map', () => {
    const { vault } = setup();
    vault.set('app-one', 'a', 'AAA', { secret: true });
    vault.set('app-one', 'b', 'BBB');
    expect(vault.resolveAll('app-one')).toEqual({ a: 'AAA', b: 'BBB' });
  });
});

describe('SecretVault — isolation', () => {
  it('app A cannot read app B keys', () => {
    const { vault } = setup();
    vault.set('app-one', 'token', 'A_TOKEN', { secret: true });
    vault.set('app-two', 'token', 'B_TOKEN', { secret: true });
    expect(vault.get('app-one', 'token')).toBe('A_TOKEN');
    expect(vault.get('app-two', 'token')).toBe('B_TOKEN');
  });

  it('list is per-app', () => {
    const { vault } = setup();
    vault.set('app-one', 'a', '1');
    vault.set('app-two', 'b', '2');
    expect(vault.list('app-one').map((m) => m.key)).toEqual(['a']);
    expect(vault.list('app-two').map((m) => m.key)).toEqual(['b']);
  });
});

describe('SecretVault — input validation', () => {
  it('rejects malformed appId', () => {
    const { vault } = setup();
    expect(() => vault.set('Bad-App', 'k', 'v')).toThrow();
    expect(() => vault.get('Bad-App', 'k')).toThrow();
  });

  it('rejects malformed key', () => {
    const { vault } = setup();
    expect(() => vault.set('app-one', '0bad', 'v')).toThrow();
    expect(() => vault.set('app-one', 'has-dash', 'v')).toThrow();
    expect(() => vault.set('app-one', "'; DROP TABLE x; --", 'v')).toThrow();
  });

  it('rejects non-string values', () => {
    const { vault } = setup();
    // @ts-expect-error wrong type intentionally
    expect(() => vault.set('app-one', 'k', 42)).toThrow();
    // @ts-expect-error wrong type intentionally
    expect(() => vault.set('app-one', 'k', { foo: 'bar' })).toThrow();
  });
});

describe('SecretVault — cascade with app deletion', () => {
  it('configs are removed when the app row is deleted', () => {
    const { db, vault } = setup();
    vault.set('app-one', 'a', '1');
    vault.set('app-one', 'b', '2');

    db.prepare('DELETE FROM lumos_app_apps WHERE id = ?').run('app-one');

    expect(vault.list('app-one')).toEqual([]);
  });
});
