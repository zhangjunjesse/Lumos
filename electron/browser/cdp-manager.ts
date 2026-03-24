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
  private attachInFlight: Map<string, Promise<void>>;
  private debuggerListeners: Map<
    number,
    {
      tabId: string;
      detachListener: (_event: Electron.Event, reason: string) => void;
      messageListener: (_event: Electron.Event, method: string, params: any) => void;
    }
  >;
  private reconnectAttempts: Map<string, number>;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly PROTOCOL_VERSION = '1.3';

  constructor() {
    super();
    this.connections = new Map();
    this.attachInFlight = new Map();
    this.debuggerListeners = new Map();
    this.reconnectAttempts = new Map();
  }

  /**
   * 连接到 WebContents 的调试器
   */
  async attach(tabId: string, webContents: WebContents): Promise<void> {
    const inFlight = this.attachInFlight.get(tabId);
    if (inFlight) {
      return inFlight;
    }

    const attachPromise = this.attachInternal(tabId, webContents).finally(() => {
      this.attachInFlight.delete(tabId);
    });
    this.attachInFlight.set(tabId, attachPromise);
    return attachPromise;
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
      this.unregisterDebuggerListeners(webContents);
      this.connections.delete(tabId);
      this.reconnectAttempts.delete(tabId);

      if (webContents.debugger.isAttached()) {
        webContents.debugger.detach();
      }

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

  private async attachInternal(tabId: string, webContents: WebContents): Promise<void> {
    try {
      if (webContents.isDestroyed()) {
        throw new Error('WebContents is already destroyed');
      }

      const currentTabId = this.findTabIdByWebContents(webContents);
      if (currentTabId && currentTabId !== tabId) {
        this.connections.delete(currentTabId);
      }

      const wasAttached = webContents.debugger.isAttached();
      if (!wasAttached) {
        webContents.debugger.attach(this.PROTOCOL_VERSION);
      }

      this.registerDebuggerListeners(tabId, webContents);
      this.connections.set(tabId, webContents);
      this.reconnectAttempts.set(tabId, 0);

      if (wasAttached) {
        console.warn(`Debugger already attached to tab ${tabId}, reusing existing session`);
      } else {
        console.log(`CDP attached to tab ${tabId}`);
      }
      this.emit('attached', { tabId, reused: wasAttached });
    } catch (error) {
      console.error(`Failed to attach CDP to tab ${tabId}:`, error);
      throw new Error(`CDP attach failed: ${error instanceof Error ? error.message : String(error)}`);
    }
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

    this.unregisterDebuggerListeners(webContents);
    this.connections.delete(tabId);
    this.reconnectAttempts.delete(tabId);
    this.emit('detached', { tabId, reason });

    // 如果不是主动断开，尝试重连
    if (
      !webContents.isDestroyed()
      && reason !== 'target closed'
      && reason !== 'canceled by user'
    ) {
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
        if (webContents.isDestroyed()) {
          this.reconnectAttempts.delete(tabId);
          return;
        }

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

  private registerDebuggerListeners(tabId: string, webContents: WebContents): void {
    const existing = this.debuggerListeners.get(webContents.id);
    if (existing?.tabId === tabId) {
      return;
    }

    if (existing) {
      webContents.debugger.removeListener('detach', existing.detachListener);
      webContents.debugger.removeListener('message', existing.messageListener);
    }

    const detachListener = (_event: Electron.Event, reason: string) => {
      this.handleDetach(tabId, webContents, reason);
    };
    const messageListener = (_event: Electron.Event, method: string, params: any) => {
      this.emit('message', { tabId, method, params });
    };

    webContents.debugger.on('detach', detachListener);
    webContents.debugger.on('message', messageListener);
    this.debuggerListeners.set(webContents.id, {
      tabId,
      detachListener,
      messageListener,
    });
  }

  private unregisterDebuggerListeners(webContents: WebContents): void {
    const existing = this.debuggerListeners.get(webContents.id);
    if (!existing) {
      return;
    }

    webContents.debugger.removeListener('detach', existing.detachListener);
    webContents.debugger.removeListener('message', existing.messageListener);
    this.debuggerListeners.delete(webContents.id);
  }

  private findTabIdByWebContents(webContents: WebContents): string | null {
    for (const [tabId, current] of this.connections.entries()) {
      if (current.id === webContents.id) {
        return tabId;
      }
    }

    return null;
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

    this.attachInFlight.clear();
    this.debuggerListeners.clear();
  }
}
