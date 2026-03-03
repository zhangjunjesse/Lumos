/**
 * MCP Environment Manager
 * 管理 MCP 服务器的环境变量注入
 */

import { CookieSyncManager } from './cookie-sync';

export interface MCPEnvironment {
  [key: string]: string;
}

export class MCPEnvironmentManager {
  private cookieSyncManager: CookieSyncManager;
  private mcpEnvironments: Map<string, MCPEnvironment>;

  constructor(cookieSyncManager: CookieSyncManager) {
    this.cookieSyncManager = cookieSyncManager;
    this.mcpEnvironments = new Map();

    // 监听 Cookie 变化
    this.setupCookieListener();
  }

  /**
   * 设置 Cookie 变化监听
   */
  private setupCookieListener(): void {
    this.cookieSyncManager.on('cookie-changed', (event: any) => {
      this.updateMCPEnvironment(event.mcpName, event.domain, event.name, event.value);
    });
  }

  /**
   * 更新 MCP 环境变量
   */
  private updateMCPEnvironment(
    mcpName: string,
    domain: string,
    cookieName: string,
    value: string
  ): void {
    let env = this.mcpEnvironments.get(mcpName);
    if (!env) {
      env = {};
      this.mcpEnvironments.set(mcpName, env);
    }

    // 使用约定的环境变量名格式
    // 例如：bilibili.com 的 SESSDATA -> BILIBILI_SESSDATA
    const envKey = this.generateEnvKey(domain, cookieName);
    env[envKey] = value;

    console.log(`Updated environment for MCP ${mcpName}: ${envKey}=${value ? '[REDACTED]' : '(removed)'}`);
  }

  /**
   * 生成环境变量名
   */
  private generateEnvKey(domain: string, cookieName: string): string {
    // 移除 TLD 和子域名，只保留主域名
    const mainDomain = domain
      .replace(/^\./, '') // 移除前导点
      .split('.')
      .slice(-2, -1)[0] // 获取主域名部分
      .toUpperCase();

    const normalizedCookieName = cookieName.toUpperCase().replace(/[^A-Z0-9]/g, '_');

    return `${mainDomain}_${normalizedCookieName}`;
  }

  /**
   * 获取 MCP 的环境变量
   */
  getMCPEnvironment(mcpName: string): MCPEnvironment {
    return this.mcpEnvironments.get(mcpName) || {};
  }

  /**
   * 为 MCP 注册 Cookie 监听
   */
  registerCookieWatch(mcpName: string, domain: string, cookieName: string): void {
    try {
      this.cookieSyncManager.watchCookie(domain, cookieName, mcpName);

      // 立即获取当前值
      const value = this.cookieSyncManager.getCookieValue(domain, cookieName, mcpName);
      if (value) {
        this.updateMCPEnvironment(mcpName, domain, cookieName, value);
      }
    } catch (error) {
      console.error(`Failed to register cookie watch for MCP ${mcpName}:`, error);
      throw error;
    }
  }

  /**
   * 取消 MCP 的 Cookie 监听
   */
  unregisterCookieWatch(mcpName: string, domain: string, cookieName: string): void {
    try {
      this.cookieSyncManager.unwatchCookie(domain, cookieName, mcpName);

      // 从环境变量中移除
      const env = this.mcpEnvironments.get(mcpName);
      if (env) {
        const envKey = this.generateEnvKey(domain, cookieName);
        delete env[envKey];
      }
    } catch (error) {
      console.error(`Failed to unregister cookie watch for MCP ${mcpName}:`, error);
      throw error;
    }
  }

  /**
   * 清理 MCP 的所有环境变量
   */
  clearMCPEnvironment(mcpName: string): void {
    this.mcpEnvironments.delete(mcpName);
  }
}
