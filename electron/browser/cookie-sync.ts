/**
 * Cookie Sync Manager
 * 监听 Cookie 变化并自动同步到 MCP 服务器
 */

import { session } from 'electron';
import { EventEmitter } from 'events';
import { CookieEncryptionManager } from './cookie-encryption';
import { MCPCookiePermissionManager } from './mcp-cookie-permission';

export interface CookieChangeEvent {
  domain: string;
  name: string;
  value: string;
  removed: boolean;
}

export class CookieSyncManager extends EventEmitter {
  private sessionPartition: string;
  private encryptionManager: CookieEncryptionManager;
  private permissionManager: MCPCookiePermissionManager;
  private watchedCookies: Set<string>;
  private syncInterval: NodeJS.Timeout | null;

  constructor(
    sessionPartition: string,
    encryptionManager: CookieEncryptionManager,
    permissionManager: MCPCookiePermissionManager
  ) {
    super();
    this.sessionPartition = sessionPartition;
    this.encryptionManager = encryptionManager;
    this.permissionManager = permissionManager;
    this.watchedCookies = new Set();
    this.syncInterval = null;

    this.startMonitoring();
  }

  /**
   * 开始监听 Cookie 变化
   */
  private startMonitoring(): void {
    const ses = session.fromPartition(this.sessionPartition);

    // 监听 Cookie 变化
    ses.cookies.on('changed', (_event, cookie, cause, removed) => {
      this.handleCookieChange(cookie, removed);
    });

    // 定期同步（每 30 秒）
    this.syncInterval = setInterval(() => {
      this.syncAllWatchedCookies();
    }, 30000);
  }

  /**
   * 处理 Cookie 变化
   */
  private async handleCookieChange(
    cookie: Electron.Cookie,
    removed: boolean
  ): Promise<void> {
    const key = `${cookie.domain}:${cookie.name}`;

    // 检查是否在监听列表中
    const watchers = this.permissionManager.getCookieWatchers(
      cookie.domain,
      cookie.name
    );

    if (watchers.length === 0) {
      return;
    }

    // 加密存储 Cookie
    if (!removed) {
      try {
        this.encryptionManager.saveCookie({
          domain: cookie.domain,
          name: cookie.name,
          value: cookie.value,
          expires: cookie.expirationDate
            ? Math.floor(cookie.expirationDate * 1000)
            : undefined,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          sameSite: cookie.sameSite as any,
          path: cookie.path,
        });
      } catch (error) {
        console.error(`Failed to encrypt cookie ${key}:`, error);
      }
    } else {
      this.encryptionManager.deleteCookie(cookie.domain, cookie.name);
    }

    // 通知所有监听的 MCP
    for (const watcher of watchers) {
      if (watcher.autoSync) {
        this.emit('cookie-changed', {
          mcpName: watcher.mcpName,
          domain: cookie.domain,
          name: cookie.name,
          value: removed ? '' : cookie.value,
          removed,
        });
      }
    }
  }

  /**
   * 添加 Cookie 监听
   */
  watchCookie(domain: string, cookieName: string, mcpName: string): void {
    // 检查权限
    if (!this.permissionManager.hasPermission(mcpName, domain)) {
      throw new Error(`MCP ${mcpName} does not have permission to access ${domain}`);
    }

    // 添加到监听列表
    this.permissionManager.addCookieWatch({
      domain,
      cookieName,
      mcpName,
      autoSync: true,
      createdAt: Date.now(),
    });

    const key = `${domain}:${cookieName}`;
    this.watchedCookies.add(key);

    console.log(`Started watching cookie ${key} for MCP ${mcpName}`);
  }

  /**
   * 移除 Cookie 监听
   */
  unwatchCookie(domain: string, cookieName: string, mcpName: string): void {
    this.permissionManager.removeCookieWatch(domain, cookieName, mcpName);

    const key = `${domain}:${cookieName}`;
    const watchers = this.permissionManager.getCookieWatchers(domain, cookieName);

    if (watchers.length === 0) {
      this.watchedCookies.delete(key);
    }

    console.log(`Stopped watching cookie ${key} for MCP ${mcpName}`);
  }

  /**
   * 获取 Cookie 值（从加密存储）
   */
  getCookieValue(domain: string, cookieName: string, mcpName: string): string | null {
    // 检查权限
    if (!this.permissionManager.hasPermission(mcpName, domain)) {
      throw new Error(`MCP ${mcpName} does not have permission to access ${domain}`);
    }

    const cookie = this.encryptionManager.getCookie(domain, cookieName);
    return cookie ? cookie.value : null;
  }

  /**
   * 同步所有监听的 Cookie
   */
  private async syncAllWatchedCookies(): Promise<void> {
    const ses = session.fromPartition(this.sessionPartition);

    for (const key of this.watchedCookies) {
      const [domain, name] = key.split(':');

      try {
        const cookies = await ses.cookies.get({ domain, name });

        if (cookies.length > 0) {
          const cookie = cookies[0];
          await this.handleCookieChange(cookie, false);
        }
      } catch (error) {
        console.error(`Failed to sync cookie ${key}:`, error);
      }
    }
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}
