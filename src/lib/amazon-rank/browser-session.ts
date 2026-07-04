import {
  postToBrowserBridge,
  resolveBrowserBridgeRuntimeConfig,
} from '@/lib/browser-runtime/bridge-client';
import { createBrowserBridgeApi } from '@/lib/workflow/code-browser-bridge';
import type { BrowserBridgeApi } from '@/lib/workflow/code-handler-types';

import type { RankSettings } from './types';

export interface RankBrowserSession {
  api: BrowserBridgeApi;
  pageId: string;
  close(): Promise<void>;
}

/**
 * 为一次排名运行开一个后台页：
 * - background:true 全程后台，绝不抢用户正在看的界面（派生页由 bridge 继承后台属性）
 * - 默认无痕分区，避免账号登录态影响排名个性化
 * - browserContextId 尊重用户在设置里选的浏览器（内置 / AdsPower / 外部 CDP）
 */
export async function openRankBrowserSession(input: {
  settings: RankSettings;
  runId: string;
  signal?: AbortSignal;
}): Promise<RankBrowserSession | { error: string }> {
  const { settings, runId, signal } = input;
  const lockOwnerId = `amazon-rank:${runId}`;
  const config = resolveBrowserBridgeRuntimeConfig({
    browserContextId: settings.browserContextId,
    lockOwnerId,
  });
  if (!config) {
    return { error: '浏览器未连接：请确认 Lumos 桌面端已启动（Browser Bridge 未就绪）' };
  }

  let pageId: string;
  try {
    const created = await postToBrowserBridge<{ ok?: boolean; pageId?: string }>(
      config,
      '/v1/pages/new',
      {
        url: `https://${settings.site}`,
        background: true,
        ...(settings.incognito ? { incognito: true } : {}),
      },
      { signal, timeoutMs: 60_000 },
    );
    if (!created.pageId) {
      return { error: '浏览器开页失败：bridge 没有返回页面 ID' };
    }
    pageId = created.pageId;
  } catch (error) {
    return { error: `浏览器开页失败：${error instanceof Error ? error.message : String(error)}` };
  }

  const api = createBrowserBridgeApi({
    signal,
    background: true,
    browserContextId: settings.browserContextId,
    lockOwnerId,
  });
  try {
    await api.selectPage(pageId);
  } catch (error) {
    return { error: `浏览器绑定页面失败：${error instanceof Error ? error.message : String(error)}` };
  }

  return {
    api,
    pageId,
    async close() {
      try {
        await api.closePage(pageId);
      } catch {
        /* 关页失败不影响结果 */
      }
      try {
        await api.release();
      } catch {
        /* 租约释放失败不影响结果 */
      }
    },
  };
}
