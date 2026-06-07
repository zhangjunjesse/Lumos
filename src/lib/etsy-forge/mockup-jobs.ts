// 单发出图运行记录:「微调」「按方向出图」开跑记 running、跑完更 success/failed,供右下角「任务」浮层和 SOP/裂变一起统一展示。
// 镜像裂变 run 的轻量做法。listForDock 返回近一批(含终态,让「生成中→完成/失败」可见),并丢弃 stale running(进程崩留下的)。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { COLLECTIONS, type ManualProductRow, type MockupJobRow, type ProductRow } from './types';

const STALE_MS = 15 * 60 * 1000; // running 超过这个时长没收尾 = 进程崩了,不再显示「生成中」
const DOCK_LIMIT = 20; // 浮层只显示近 20 条单发记录
const KIND_CN: Record<MockupJobRow['kind'], string> = { compose: '微调', direction: '按方向出图' };

export interface MockupJobView {
  id: string;
  kind: MockupJobRow['kind'];
  kind_cn: string;
  title: string; // 目标产品标题
  label: string; // 方向名 / 提示词片段
  status: MockupJobRow['status'];
  started_at: string;
  failure_reason?: string;
}

// 开跑:建一条 running,返回 jobId。
export function startMockupJob(
  store: AppDataStore,
  input: { userId: string; kind: MockupJobRow['kind']; productId: string; label?: string },
): string {
  const row = store.create(COLLECTIONS.MOCKUP_JOBS, {
    user_id: input.userId,
    kind: input.kind,
    product_id: input.productId,
    label: input.label ?? '',
    status: 'running',
    created_at: new Date().toISOString(),
  });
  return row.id as string;
}

// 收尾:更新终态。jobId 为空(没建成功)时安全跳过。
export function finishMockupJob(store: AppDataStore, jobId: string | null, ok: boolean, failureReason?: string): void {
  if (!jobId) return;
  store.update(COLLECTIONS.MOCKUP_JOBS, jobId, {
    status: ok ? 'success' : 'failed',
    failure_reason: failureReason ?? '',
    finished_at: new Date().toISOString(),
  });
}

function titleOf(store: AppDataStore, pid: string): string {
  if (!pid) return '产品';
  const p = store.get<ProductRow>(COLLECTIONS.PRODUCTS, pid);
  if (p?.title) return p.title;
  const m = store.get<ManualProductRow>(COLLECTIONS.MANUAL_PRODUCTS, pid);
  return m?.name ?? '产品';
}

// 浮层用:近 DOCK_LIMIT 条(新在前),丢弃 stale running。导出供路由 + 测试。
export function listMockupJobsForDock(store: AppDataStore, userId: string): MockupJobView[] {
  const cutoff = Date.now() - STALE_MS;
  return store
    .query<MockupJobRow>(COLLECTIONS.MOCKUP_JOBS, { filter: { user_id: userId }, orderBy: { field: 'created_at', direction: 'desc' }, limit: 100 })
    .filter((r) => r.status !== 'running' || new Date(r.created_at).getTime() >= cutoff)
    .slice(0, DOCK_LIMIT)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      kind_cn: KIND_CN[r.kind] ?? r.kind,
      title: titleOf(store, r.product_id),
      label: typeof r.label === 'string' ? r.label : '',
      status: r.status,
      started_at: r.created_at,
      failure_reason: r.failure_reason,
    }));
}
