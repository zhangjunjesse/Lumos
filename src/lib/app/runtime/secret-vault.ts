import type Database from 'better-sqlite3';

import type { SecretCryptor } from './secret-cryptor';
import { getActiveCryptor } from './secret-cryptor';

/**
 * Single entry point for an application's persisted config (both secret
 * and non-secret values). All values are encrypted at rest via the
 * SecretCryptor — this is intentional even for non-secret values so that:
 *
 *   1. The encryption layer is exercised continuously (avoids "we forgot
 *      to encrypt this field" bugs).
 *   2. The on-disk SQLite file looks uniformly opaque, so a casual file
 *      inspector cannot harvest plaintext config.
 *
 * Secrets are differentiated only at access time by the `is_secret`
 * column. Code paths that traverse to the renderer process MUST inspect
 * `is_secret` and refuse to forward those values; non-secret values may
 * be passed through.
 */

const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const APP_ID_RE = /^[a-z][a-z0-9-]{2,63}$/;

function assertAppId(appId: string): void {
  if (!APP_ID_RE.test(appId)) {
    throw new Error(
      `Invalid appId: ${JSON.stringify(appId)} (must match /^[a-z][a-z0-9-]{2,63}$/)`,
    );
  }
}

function assertKey(key: string): void {
  if (!KEY_RE.test(key)) {
    throw new Error(
      `Invalid config key: ${JSON.stringify(key)} (must match /^[a-z][a-z0-9_]{0,63}$/)`,
    );
  }
}

export interface ConfigEntryMeta {
  key: string;
  isSecret: boolean;
  updatedAt: number;
}

export interface ConfigEntry extends ConfigEntryMeta {
  value: string;
}

export interface SecretVault {
  set(appId: string, key: string, value: string, opts?: { secret?: boolean }): void;
  get(appId: string, key: string): string | null;
  delete(appId: string, key: string): boolean;
  /** Return all keys for an app with metadata only — values are NOT decrypted. */
  list(appId: string): ConfigEntryMeta[];
  /**
   * Return all key/value pairs decrypted, keyed by config key.
   * **SECURITY**: callers must NEVER serialize this entire map to a renderer
   * process or external API. Use it only for in-process workflow context
   * resolution. Use `listMeta` + `get` if you need fine-grained access.
   */
  resolveAll(appId: string): Record<string, string>;
  /** Resolve a single value, returning null if missing. */
  resolve(appId: string, key: string): string | null;
  /** Purge all config for an app (called by uninstaller). */
  clearAll(appId: string): number;
}

export interface SecretVaultDeps {
  db: Database.Database;
  cryptor?: SecretCryptor;
}

export function createSecretVault(deps: SecretVaultDeps): SecretVault {
  const { db } = deps;
  const cryptor = deps.cryptor ?? getActiveCryptor();

  return {
    set(appId, key, value, opts): void {
      assertAppId(appId);
      assertKey(key);
      if (typeof value !== 'string') {
        throw new Error(
          `Config value must be a string; got ${typeof value}. JSON-encode complex values at the call site.`,
        );
      }
      const encrypted = cryptor.encrypt(value);
      const isSecret = opts?.secret ? 1 : 0;
      const now = Date.now();
      db.prepare(
        `INSERT INTO lumos_app_configs (app_id, key, value_encrypted, is_secret, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (app_id, key) DO UPDATE SET
           value_encrypted = excluded.value_encrypted,
           is_secret = excluded.is_secret,
           updated_at = excluded.updated_at`,
      ).run(appId, key, encrypted, isSecret, now);
    },

    get(appId, key): string | null {
      assertAppId(appId);
      assertKey(key);
      const row = db
        .prepare(
          `SELECT value_encrypted FROM lumos_app_configs
           WHERE app_id = ? AND key = ?`,
        )
        .get(appId, key) as { value_encrypted: string } | undefined;
      if (!row) return null;
      return cryptor.decrypt(row.value_encrypted);
    },

    delete(appId, key): boolean {
      assertAppId(appId);
      assertKey(key);
      const info = db
        .prepare(
          `DELETE FROM lumos_app_configs
           WHERE app_id = ? AND key = ?`,
        )
        .run(appId, key);
      return info.changes > 0;
    },

    list(appId): ConfigEntryMeta[] {
      assertAppId(appId);
      const rows = db
        .prepare(
          `SELECT key, is_secret, updated_at FROM lumos_app_configs
           WHERE app_id = ? ORDER BY key`,
        )
        .all(appId) as { key: string; is_secret: number; updated_at: number }[];
      return rows.map((r) => ({
        key: r.key,
        isSecret: r.is_secret === 1,
        updatedAt: r.updated_at,
      }));
    },

    resolveAll(appId): Record<string, string> {
      assertAppId(appId);
      const rows = db
        .prepare(
          `SELECT key, value_encrypted FROM lumos_app_configs
           WHERE app_id = ?`,
        )
        .all(appId) as { key: string; value_encrypted: string }[];
      const out: Record<string, string> = {};
      for (const r of rows) {
        out[r.key] = cryptor.decrypt(r.value_encrypted);
      }
      return out;
    },

    resolve(appId, key): string | null {
      return this.get(appId, key);
    },

    clearAll(appId): number {
      assertAppId(appId);
      const info = db
        .prepare(`DELETE FROM lumos_app_configs WHERE app_id = ?`)
        .run(appId);
      return info.changes as number;
    },
  };
}
