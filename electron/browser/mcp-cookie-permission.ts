/**
 * MCP Cookie Permission Manager
 * 管理 MCP 服务器对 Cookie 的访问权限
 */

import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

export interface MCPCookiePermission {
  mcpName: string;
  domain: string;
  grantedAt: number;
  grantedBy?: string;
}

export interface CookieWatchConfig {
  domain: string;
  cookieName: string;
  mcpName: string;
  autoSync: boolean;
  createdAt: number;
}

export class MCPCookiePermissionManager {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const defaultPath = path.join(app.getPath('userData'), 'mcp-permissions.db');
    this.db = new Database(dbPath || defaultPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_cookie_permissions (
        mcp_name TEXT NOT NULL,
        domain TEXT NOT NULL,
        granted_at INTEGER NOT NULL,
        granted_by TEXT,
        PRIMARY KEY (mcp_name, domain)
      );

      CREATE TABLE IF NOT EXISTS cookie_watch_list (
        domain TEXT NOT NULL,
        cookie_name TEXT NOT NULL,
        mcp_name TEXT NOT NULL,
        auto_sync INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (domain, cookie_name, mcp_name)
      );

      CREATE INDEX IF NOT EXISTS idx_permissions_mcp ON mcp_cookie_permissions(mcp_name);
      CREATE INDEX IF NOT EXISTS idx_watch_mcp ON cookie_watch_list(mcp_name);
    `);
  }

  /**
   * 授予 MCP 访问域名 Cookie 的权限
   */
  grantPermission(mcpName: string, domain: string, grantedBy?: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO mcp_cookie_permissions
      (mcp_name, domain, granted_at, granted_by)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(mcpName, domain, Date.now(), grantedBy || null);
  }

  /**
   * 撤销 MCP 访问域名 Cookie 的权限
   */
  revokePermission(mcpName: string, domain: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM mcp_cookie_permissions
      WHERE mcp_name = ? AND domain = ?
    `);
    stmt.run(mcpName, domain);
  }

  /**
   * 检查 MCP 是否有权限访问域名的 Cookie
   */
  hasPermission(mcpName: string, domain: string): boolean {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM mcp_cookie_permissions
      WHERE mcp_name = ? AND (domain = ? OR ? LIKE '%' || domain)
    `);

    const result = stmt.get(mcpName, domain, domain) as { count: number };
    return result.count > 0;
  }

  /**
   * 获取 MCP 的所有权限
   */
  getMCPPermissions(mcpName: string): MCPCookiePermission[] {
    const stmt = this.db.prepare(`
      SELECT * FROM mcp_cookie_permissions WHERE mcp_name = ?
    `);

    const rows = stmt.all(mcpName) as any[];
    return rows.map(row => ({
      mcpName: row.mcp_name,
      domain: row.domain,
      grantedAt: row.granted_at,
      grantedBy: row.granted_by,
    }));
  }

  /**
   * 获取域名的所有权限
   */
  getDomainPermissions(domain: string): MCPCookiePermission[] {
    const stmt = this.db.prepare(`
      SELECT * FROM mcp_cookie_permissions WHERE domain = ?
    `);

    const rows = stmt.all(domain) as any[];
    return rows.map(row => ({
      mcpName: row.mcp_name,
      domain: row.domain,
      grantedAt: row.granted_at,
      grantedBy: row.granted_by,
    }));
  }

  /**
   * 添加 Cookie 监听配置
   */
  addCookieWatch(config: CookieWatchConfig): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO cookie_watch_list
      (domain, cookie_name, mcp_name, auto_sync, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      config.domain,
      config.cookieName,
      config.mcpName,
      config.autoSync ? 1 : 0,
      config.createdAt
    );
  }

  /**
   * 移除 Cookie 监听配置
   */
  removeCookieWatch(domain: string, cookieName: string, mcpName: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM cookie_watch_list
      WHERE domain = ? AND cookie_name = ? AND mcp_name = ?
    `);
    stmt.run(domain, cookieName, mcpName);
  }

  /**
   * 获取 MCP 的所有监听配置
   */
  getMCPWatchList(mcpName: string): CookieWatchConfig[] {
    const stmt = this.db.prepare(`
      SELECT * FROM cookie_watch_list WHERE mcp_name = ?
    `);

    const rows = stmt.all(mcpName) as any[];
    return rows.map(row => ({
      domain: row.domain,
      cookieName: row.cookie_name,
      mcpName: row.mcp_name,
      autoSync: row.auto_sync === 1,
      createdAt: row.created_at,
    }));
  }

  /**
   * 获取特定 Cookie 的所有监听配置
   */
  getCookieWatchers(domain: string, cookieName: string): CookieWatchConfig[] {
    const stmt = this.db.prepare(`
      SELECT * FROM cookie_watch_list
      WHERE domain = ? AND cookie_name = ?
    `);

    const rows = stmt.all(domain, cookieName) as any[];
    return rows.map(row => ({
      domain: row.domain,
      cookieName: row.cookie_name,
      mcpName: row.mcp_name,
      autoSync: row.auto_sync === 1,
      createdAt: row.created_at,
    }));
  }

  /**
   * 关闭数据库
   */
  close(): void {
    this.db.close();
  }
}
