// 「额外要求」常用库:用户把生成图的自由要求存下来反复用。简单 CRUD。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { COLLECTIONS } from '../types';

export interface ExtraPromptRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  text: string;
  created_at: string;
}

export function listExtraPrompts(store: AppDataStore, userId: string): ExtraPromptRow[] {
  return store.query<ExtraPromptRow>(COLLECTIONS.EXTRA_PROMPTS, {
    filter: { user_id: userId },
    orderBy: { field: 'created_at', direction: 'desc' },
    limit: 200,
  });
}

export function createExtraPrompt(store: AppDataStore, userId: string, text: string): ExtraPromptRow | null {
  const t = text.trim();
  if (!t) return null;
  // 去重:同文本已存就返回旧的,不重复存。
  const existing = listExtraPrompts(store, userId).find((r) => r.text === t);
  if (existing) return existing;
  return store.create<ExtraPromptRow>(COLLECTIONS.EXTRA_PROMPTS, {
    user_id: userId,
    text: t,
    created_at: new Date().toISOString(),
  } as ExtraPromptRow);
}

export function deleteExtraPrompt(store: AppDataStore, userId: string, id: string): boolean {
  const row = store.get<ExtraPromptRow>(COLLECTIONS.EXTRA_PROMPTS, id);
  if (!row || row.user_id !== userId) return false;
  return store.delete(COLLECTIONS.EXTRA_PROMPTS, id);
}
