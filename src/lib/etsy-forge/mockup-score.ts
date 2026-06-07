// 「我的产品」给一张产品图(mockup)打分:1-10;0 = 清除评分。用于挑变体排序/筛选。
// 业务很薄,但抽出来让 route 只做参数解析、并可单测 clamp / 归属校验。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { COLLECTIONS, type MockupRow } from './types';

// 把任意输入收敛成 [0,10] 整数;非数字按 0(未打分)。
export function clampScore(score: unknown): number {
  const n = Math.round(Number(score));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, n));
}

export function setMockupScore(store: AppDataStore, userId: string, id: string, score: unknown): { ok: boolean; score?: number; error?: string } {
  const m = store.get<MockupRow>(COLLECTIONS.MOCKUPS, id);
  if (!m || m.user_id !== userId) return { ok: false, error: '记录不存在' };
  const n = clampScore(score);
  store.update(COLLECTIONS.MOCKUPS, id, { score: n });
  return { ok: true, score: n };
}
