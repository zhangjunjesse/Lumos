// 图片异步生成任务的读写。前端轮询出进度，成功后客户端把 result_src 填进图位再删 job。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { COLLECTIONS } from '../types';
import type { PhotoGenJobRow, PhotoRole } from './types';

export function startPhotoJob(store: AppDataStore, userId: string, listingId: string, label: string, role?: PhotoRole): PhotoGenJobRow {
  return store.create<PhotoGenJobRow>(COLLECTIONS.LISTING_PHOTO_JOBS, {
    user_id: userId,
    listing_id: listingId,
    role,
    label,
    status: 'running',
    created_at: new Date().toISOString(),
  } as PhotoGenJobRow);
}

export function finishPhotoJob(store: AppDataStore, jobId: string, ok: boolean, resultSrc?: string, error?: string): void {
  store.update<PhotoGenJobRow>(COLLECTIONS.LISTING_PHOTO_JOBS, jobId, {
    status: ok ? 'success' : 'failed',
    result_src: resultSrc,
    error,
    finished_at: new Date().toISOString(),
  });
}

export function listPhotoJobs(store: AppDataStore, userId: string, listingId?: string): PhotoGenJobRow[] {
  return store.query<PhotoGenJobRow>(COLLECTIONS.LISTING_PHOTO_JOBS, {
    filter: listingId ? { user_id: userId, listing_id: listingId } : { user_id: userId },
    orderBy: { field: 'created_at', direction: 'desc' },
    limit: 200,
  });
}

export function deletePhotoJob(store: AppDataStore, userId: string, id: string): boolean {
  const j = store.get<PhotoGenJobRow>(COLLECTIONS.LISTING_PHOTO_JOBS, id);
  if (!j || j.user_id !== userId) return false;
  return store.delete(COLLECTIONS.LISTING_PHOTO_JOBS, id);
}
