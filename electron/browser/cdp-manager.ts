/**
 * CDP (Chrome DevTools Protocol) Manager
 *
 * 使用 webContents.debugger 而非 remote-debugging-port，避免端口冲突
 * 支持自动重连和错误恢复
 */

import { WebContents } from 'electron';
import { EventEmitter } from 'events';

export interface CDPCommand {
  method: string;
  params?: any;
}

export interface CDPResponse {
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

export class CDPManager extends EventEmitter {
  private connections: Map<string, WebContents>;
  private reconnectAttempts: Map<string, number>;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly PROTOCOL_VERSION = '1.3';

  constructor() {
    super();
    this.connections = new Map();
    this.reconnectAttempts = new Map();
  }

  /**
   * 连接到 WebContents 的调试器
   */
  async attach(tabId: string, webContents: WebContents): Promise<void> {
    try {
      // 检查是否已经连接
      if (webContents.debugger.isAttached()) {
        console.warn(`Debugger already attached to tab ${tabId}`);
        return;
      }

      // 附加调试器
      webContents.debugger.attach(this.PROTOCOL_VERSION);

      // 存储连接
      this.connections.set(tabId, webContents);
      this.reconnectAttempts.set(tabId, 0);

      // 监听断开事件
      webContents.debugger.on('detach', (_event, reason) => {
        this.handleDetach(tabId, webContents, reason);
      });

      // 监听消息事件
      webContents.debugger.on('message', (_event, method, params) => {
        this.emit('message', { tabId, method, params });
      });

      this.emit('attached', { tabId });
      console.log(`CDP attached to tab ${tabId}`);
    } catch (error) {
      console.error(`Failed to attach CDP to tab ${tabId}:`, error);
      throw new Error(`CDP attach failed: ${error.message}`);
    }
  }

  /**
   * 断开调试器连接
   */
  async detach(tabId: string): Promise<void> {
    const webContents = this.connections.get(tabId);

    if (!webContents) {
      console.warn(`No CDP connection found for tab ${tabId}`);
      return;
    }

    try {
      if (webContents.debugger.isAttached()) {
        webContents.debugger.detach();
      }

      this.connections.delete(tabId);
      this.reconnectAttempts.delete(tabId);

      this.emit('detached', { tabId });
      console.log(`CDP detached from tab ${tabId}`);
    } catch (error) {
      console.error(`Failed to detach CDP from tab ${tabId}:`, error);
      throw new Error(`CDP detach failed: ${error.message}`);
    }
  }

  /**
   * 发送 CDP 命令
   */
  async sendCommand(tabId: string, command: CDPCommand): Promise<CDPResponse> {
    const webContents = this.connections.get(tabId);

    if (!webContents) {
      throw new Error(`No CDP connection found for tab ${tabId}`);
    }

    if (!webContents.debugger.isAttached()) {
      throw new Error(`CDP not attached to tab ${tabId}`);
    }

    try {
      const result = await webContents.debugger.sendCommand(
        command.method,
        command.params
      );

      return { result };
    } catch (error) {
      console.error(`CDP command failed for tab ${tabId}:`, error);
      return {
        error: {
          code: -1,
          message: error.message,
        },
      };
    }
  }

  /**
   * 检查是否已连接
   */
  isAttached(tabId: string): boolean {
    const webContents = this.connections.get(tabId);
    return webContents ? webContents.debugger.isAttached() : false;
  }

  /**
   * 处理调试器断开
   */
  private handleDetach(
    tabId: string,
    webContents: WebContents,
    reason: string
  ): void {
    console.warn(`CDP detached from tab ${tabId}, reason: ${reason}`);

    this.connections.delete(tabId);
    this.emit('detached', { tabId, reason });

    // 如果不是主动断开，尝试重连
    if (reason !== 'target closed' && reason !== 'canceled by user') {
      this.attemptReconnect(tabId, webContents);
    }
  }

  /**
   * 尝试重连
   */
  private async attemptReconnect(
    tabId: string,
    webContents: WebContents
  ): Promise<void> {
    const attempts = this.reconnectAttempts.get(tabId) || 0;

    if (attempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `CDP reconnection failed after ${this.MAX_RECONNECT_ATTEMPTS} attempts for tab ${tabId}`
      );
      this.reconnectAttempts.delete(tabId);
      this.emit('reconnect-failed', { tabId });
      return;
    }

    // 指数退避延迟
    const delay = Math.min(1000 * Math.pow(2, attempts), 10000);

    setTimeout(async () => {
      try {
        console.log(
          `Attempting to reconnect CDP for tab ${tabId} (attempt ${attempts + 1})`
        );

        await this.attach(tabId, webContents);

        console.log(`CDP reconnected to tab ${tabId}`);
        this.emit('reconnected', { tabId });
      } catch (error) {
        console.error(`CDP reconnection failed for tab ${tabId}:`, error);
        this.reconnectAttempts.set(tabId, attempts + 1);
        this.attemptReconnect(tabId, webContents);
      }
    }, delay);
  }

  /**
   * 清理所有连接
   */
  async cleanup(): Promise<void> {
    const tabIds = Array.from(this.connections.keys());

    for (const tabId of tabIds) {
      try {
        await this.detach(tabId);
      } catch (error) {
        console.error(`Failed to cleanup CDP for tab ${tabId}:`, error);
      }
    }
  }
}
