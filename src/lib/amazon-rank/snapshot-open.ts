import fs from 'node:fs';

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import {
  postToBrowserBridge,
  resolveBrowserBridgeRuntimeConfig,
} from '@/lib/browser-runtime/bridge-client';

import { getRankSettings } from './settings';
import { getRunResults } from './store';

export interface OpenSnapshotDeps {
  resolveConfig?: typeof resolveBrowserBridgeRuntimeConfig;
  post?: typeof postToBrowserBridge;
  fileExists?: (filePath: string) => boolean;
}

export type OpenSnapshotOutcome =
  | { ok: true; browserContextId: string }
  | { ok: false; error: string };

/**
 * 在设置里选定的浏览器中前台打开某个关键词的快照页。
 * 只有用户显式点击「查看」才会走到这里，所以允许前台开页：
 * 内置浏览器 → bridge 转发给右侧面板；AdsPower / 外部 CDP → 在
 * 对应浏览器窗口开新标签并激活。开完立即释放租约，不占用后续查询。
 */
export async function openSnapshotInSettingsBrowser(
  store: AppDataStore,
  input: { runId: string; resultId: string; origin: string },
  deps: OpenSnapshotDeps = {},
): Promise<OpenSnapshotOutcome> {
  const resolveConfig = deps.resolveConfig ?? resolveBrowserBridgeRuntimeConfig;
  const post = deps.post ?? postToBrowserBridge;
  const fileExists = deps.fileExists ?? ((filePath: string) => fs.existsSync(filePath));

  const result = getRunResults(store, input.runId).find((row) => row.id === input.resultId);
  if (!result) return { ok: false, error: '结果不存在' };
  if (!result.snapshot_path || !fileExists(result.snapshot_path)) {
    return { ok: false, error: '这个关键词没有留下快照，或快照文件已不存在' };
  }

  const settings = getRankSettings(store);
  const config = resolveConfig({
    browserContextId: settings.browserContextId,
    lockOwnerId: `amazon-rank:snapshot:${input.resultId}`,
  });
  if (!config) {
    return { ok: false, error: '浏览器未连接：请确认 Lumos 桌面端已启动（Browser Bridge 未就绪）' };
  }

  const url =
    `${input.origin}/api/apps/builtin/amazon-rank/runs/${encodeURIComponent(input.runId)}` +
    `/snapshot?resultId=${encodeURIComponent(input.resultId)}`;

  try {
    await post(config, '/v1/pages/new', { url });
    return { ok: true, browserContextId: settings.browserContextId };
  } catch (error) {
    return { ok: false, error: friendlyOpenError(error) };
  } finally {
    try {
      await post(config, '/v1/context/release', {});
    } catch {
      /* 租约会自行过期，释放失败不影响结果 */
    }
  }
}

function friendlyOpenError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('BROWSER_CONTEXT_UNAVAILABLE')) {
    return '所选浏览器未连接：请确认它已在「设置」里配置好，且对应浏览器（如 AdsPower）已启动';
  }
  return `打开快照失败：${message}`;
}
