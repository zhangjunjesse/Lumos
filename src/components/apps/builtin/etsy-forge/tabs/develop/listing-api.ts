// 产品开发 — 前端 listing 客户端。复用 api-client 的 jf/BASE，类型直接用 lib 的窄类型(type-only import)。
import { BASE, jf } from '../../api-client';
import type { CopyDraft, ListingRow, PhotoGenJobRow } from '@/lib/etsy-forge/listing/types';

export type { ListingRow, CopyDraft, PhotoGenJobRow, PhotoRole } from '@/lib/etsy-forge/listing/types';

export const listingApi = {
  list: () => jf<{ listings: ListingRow[] }>(`${BASE}/listings`),
  // 新建：传 mockupId = 从一张产品图导入(预填主图+印花)；不传 = 空白产品。
  create: (opts: { mockupId?: string; name?: string } = {}) =>
    jf<{ ok: boolean; listing: ListingRow }>(`${BASE}/listings`, {
      method: 'POST',
      body: JSON.stringify(opts),
    }),
  update: (id: string, patch: Partial<ListingRow>) =>
    jf<{ ok: boolean; listing: ListingRow }>(`${BASE}/listings`, {
      method: 'PATCH',
      body: JSON.stringify({ id, patch }),
    }),
  remove: (id: string) =>
    jf<{ ok: boolean }>(`${BASE}/listings?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  // AI 文案草稿(草稿优先：落 copy_draft，不写正式字段)
  aiDraft: (id: string, hint?: string) =>
    jf<{ ok: boolean; draft: CopyDraft; listing: ListingRow }>(`${BASE}/listings/ai-draft`, {
      method: 'POST',
      body: JSON.stringify({ id, hint }),
    }),
  // 批量出图(SOP):印花=唯一参考；颜色集主轴；模特/场景/姿势=方向参考(读图转文字)；输出类型可选。
  generateBatch: (
    id: string,
    sel: {
      colors: string[];
      style?: string;
      extra?: string;
      modelCount?: number;
      modelRefs?: string[];
      sceneRefs?: string[];
      poseRefs?: string[];
      productRefs?: string[];
      outputs?: { model?: boolean; scene?: boolean; detail?: boolean; flat?: boolean };
    },
  ) =>
    jf<{ ok: boolean; started: number; jobIds: string[]; dirs: { modelDescs: string[]; sceneDescs: string[]; poseDescs: string[]; productDescs: string[] } }>(`${BASE}/listings/generate-batch`, {
      method: 'POST',
      body: JSON.stringify({ id, ...sel }),
    }),
  // 精修:对某张商品图按指令再编辑(异步)。
  refinePhoto: (id: string, src: string, instruction: string) =>
    jf<{ ok: boolean; jobId: string }>(`${BASE}/listings/refine-photo`, {
      method: 'POST',
      body: JSON.stringify({ id, src, instruction }),
    }),
  listPhotoJobs: (listingId?: string) =>
    jf<{ jobs: PhotoGenJobRow[] }>(`${BASE}/listings/photo-jobs${listingId ? `?listingId=${encodeURIComponent(listingId)}` : ''}`),
  deletePhotoJob: (id: string) =>
    jf<{ ok: boolean }>(`${BASE}/listings/photo-jobs?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // 额外要求常用库
  listExtraPrompts: () => jf<{ prompts: { id: string; text: string }[] }>(`${BASE}/listings/extra-prompts`),
  saveExtraPrompt: (text: string) =>
    jf<{ ok: boolean; prompt: { id: string; text: string } }>(`${BASE}/listings/extra-prompts`, { method: 'POST', body: JSON.stringify({ text }) }),
  deleteExtraPrompt: (id: string) =>
    jf<{ ok: boolean }>(`${BASE}/listings/extra-prompts?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
