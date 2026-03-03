/**
 * Cookie Encryption Manager
 * 使用 Electron safeStorage 加密存储 Cookie
 */

import { safeStorage } from 'electron';
import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

export interface EncryptedCookie {
  domain: string;
  name: string;
  value: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'no_restriction' | 'lax' | 'strict';
  path: string;
}

export class CookieEncryptionManager {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const defaultPath = path.join(app.getPath('userData'), 'cookies.db');
    this.db = new Database(dbPath || defaultPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS browser_cookies (
        domain TEXT NOT NULL,
        name TEXT NOT NULL,
        value_encrypted BLOB NOT NULL,
        expires INTEGER,
        http_only INTEGER DEFAULT 0,
        secure INTEGER DEFAULT 0,
        same_site TEXT,
        path TEXT DEFAULT '/',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (domain, name)
      );

      CREATE INDEX IF NOT EXISTS idx_cookies_domain ON browser_cookies(domain);
    `);
  }

  /**
   * 加密并存储 Cookie
   */
  saveCookie(cookie: EncryptedCookie): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption not available on this system');
    }

    const encrypted = safeStorage.encryptString(cookie.value);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO browser_cookies
      (domain, name, value_encrypted, expires, http_only, secure, same_site, path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      cookie.domain,
      cookie.name,
      encrypted,
      cookie.expires || null,
      cookie.httpOnly ? 1 : 0,
      cookie.secure ? 1 : 0,
      cookie.sameSite || null,
      cookie.path,
      Date.now()
    );
  }

  /**
   * 获取并解密 Cookie
   */
  getCookie(domain: string, name: string): EncryptedCookie | null {
    const stmt = this.db.prepare(`
      SELECT * FROM browser_cookies WHERE domain = ? AND name = ?
    `);

    const row = stmt.get(domain, name) as any;
    if (!row) return null;

    try {
      const decrypted = safeStorage.decryptString(row.value_encrypted);

      return {
        domain: row.domain,
        name: row.name,
        value: decrypted,
        expires: row.expires,
        httpOnly: row.http_only === 1,
        secure: row.secure === 1,
        sameSite: row.same_site,
        path: row.path,
      };
    } catch (error) {
      console.error(`Failed to decrypt cookie ${domain}:${name}:`, error);
      return null;
    }
  }

  /**
   * 获取域名下的所有 Cookie
   */
  getCookiesByDomain(domain: string): EncryptedCookie[] {
    const stmt = this.db.prepare(`
      SELECT * FROM browser_cookies WHERE domain = ? OR domain LIKE ?
    `);

    const rows = stmt.all(domain, `%.${domain}`) as any[];
    const cookies: EncryptedCookie[] = [];

    for (const row of rows) {
      try {
        const decrypted = safeStorage.decryptString(row.value_encrypted);
        cookies.push({
          domain: row.domain,
          name: row.name,
          value: decrypted,
          expires: row.expires,
          httpOnly: row.http_only === 1,
          secure: row.secure === 1,
          sameSite: row.same_site,
          path: row.path,
        });
      } catch (error) {
        console.error(`Failed to decrypt cookie ${row.domain}:${row.name}:`, error);
      }
    }

    return cookies;
  }

  /**
   * 删除 Cookie
   */
  deleteCookie(domain: string, name: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM browser_cookies WHERE domain = ? AND name = ?
    `);
    stmt.run(domain, name);
  }

  /**
   * 删除域名下的所有 Cookie
   */
  deleteCookiesByDomain(domain: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM browser_cookies WHERE domain = ? OR domain LIKE ?
    `);
    stmt.run(domain, `%.${domain}`);
  }

  /**
   * 清理过期的 Cookie
   */
  cleanupExpiredCookies(): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      DELETE FROM browser_cookies WHERE expires IS NOT NULL AND expires < ?
    `);
    stmt.run(now);
  }

  /**
   * 关闭数据库
   */
  close(): void {
    this.db.close();
  }
}
