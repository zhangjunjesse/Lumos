import {
  resolveBrowserBridgeRuntimeConfig,
  postToBrowserBridge,
  getFromBrowserBridge,
} from '@/lib/browser-runtime/bridge-client';
import type { BrowserBridgeApi } from './code-handler-types';

interface PageInfo { id: string; url: string; title: string }
interface SnapshotResult { title: string; content: string }

/**
 * 创建 BrowserBridgeApi 实例
 * 封装 Bridge Server HTTP 调用，代码脚本通过 ctx.browser 使用
 * 与 Agent 的 Chrome DevTools MCP 共享同一个浏览器实例和登录态
 */
export function createBrowserBridgeApi(): BrowserBridgeApi {
  const config = resolveBrowserBridgeRuntimeConfig();

  if (!config) {
    return createDisconnectedApi();
  }

  return {
    connected: true,

    async navigate(url: string) {
      await postToBrowserBridge(config, '/v1/pages/navigate', { url });
    },

    async click(selector: string) {
      await postToBrowserBridge(config, '/v1/pages/click', { selector });
    },

    async fill(selector: string, value: string) {
      await postToBrowserBridge(config, '/v1/pages/fill', { selector, value });
    },

    async type(text: string) {
      await postToBrowserBridge(config, '/v1/pages/type', { text });
    },

    async press(key: string) {
      await postToBrowserBridge(config, '/v1/pages/press', { key });
    },

    async waitFor(selector: string, options?: { timeout?: number }) {
      await postToBrowserBridge(config, '/v1/pages/wait-for', {
        selector,
        ...(options?.timeout ? { timeout: options.timeout } : {}),
      });
    },

    async evaluate<T = unknown>(script: string): Promise<T> {
      const res = await postToBrowserBridge<{ ok?: boolean; result?: T }>(
        config, '/v1/pages/evaluate', { expression: script },
      );
      return res.result as T;
    },

    async snapshot(): Promise<SnapshotResult> {
      const res = await postToBrowserBridge<{ ok?: boolean; title?: string; content?: string }>(
        config, '/v1/pages/snapshot', {},
      );
      return { title: res.title ?? '', content: res.content ?? '' };
    },

    async screenshot(): Promise<string> {
      const res = await postToBrowserBridge<{ ok?: boolean; data?: string }>(
        config, '/v1/pages/screenshot', {},
      );
      return res.data ?? '';
    },

    async pages(): Promise<PageInfo[]> {
      const res = await getFromBrowserBridge<{ ok?: boolean; pages?: PageInfo[] }>(
        config, '/v1/pages',
      );
      return res.pages ?? [];
    },

    async currentPage(): Promise<PageInfo> {
      const res = await getFromBrowserBridge<{ ok?: boolean; page?: PageInfo }>(
        config, '/v1/pages/current',
      );
      return res.page ?? { id: '', url: '', title: '' };
    },

    async newPage(url?: string): Promise<{ id: string }> {
      const res = await postToBrowserBridge<{ ok?: boolean; id?: string }>(
        config, '/v1/pages/new', { ...(url ? { url } : {}) },
      );
      return { id: res.id ?? '' };
    },

    async selectPage(id: string) {
      await postToBrowserBridge(config, '/v1/pages/select', { id });
    },

    async closePage(id: string) {
      await postToBrowserBridge(config, '/v1/pages/close', { id });
    },
  };
}

function createDisconnectedApi(): BrowserBridgeApi {
  const err = () => { throw new Error('Browser bridge 未连接，请确认 Electron 桌面端已启动'); };
  return {
    connected: false,
    navigate: err, click: err, fill: err, type: err, press: err,
    waitFor: err, evaluate: err, snapshot: err, screenshot: err,
    pages: err, currentPage: err, newPage: err, selectPage: err, closePage: err,
  };
}
