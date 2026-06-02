// Etsy 选品采集 — 运行日志。排查用，写入失败绝不影响主流程(try 包裹)。
// 桌面单用户场景，不分 user_id；日志 tab 读全部、可清空。

import { getEtsyForgeStore } from './store';
import { COLLECTIONS, type LogLevel } from './types';

const MAX_MESSAGE = 4000;

export function logEvent(scope: string, level: LogLevel, message: string, product?: string, images?: string[]): void {
  try {
    getEtsyForgeStore().create(COLLECTIONS.LOGS, {
      level,
      scope,
      product: product ? String(product).slice(0, 200) : undefined,
      images: images && images.length ? images.slice(0, 12) : undefined, // 输入图预览(缩略图),最多 12 张
      message: String(message).slice(0, MAX_MESSAGE),
      created_at: new Date().toISOString(),
    });
  } catch {
    /* 日志写入失败不影响主流程 */
  }
}
