import type { AppDataStore } from '@/lib/app/runtime/data-store';

/**
 * 修复工单：代码引擎解析失败时留档（关键词 + 快照 + 原因），
 * 提示用户「下次用 AI 操作跑一次可自动修复」；AI 生成的规则草稿被
 * 采用后，未决工单批量转为已解决。
 */

export const REPAIR_TICKETS_COLLECTION = 'repair_tickets';

export type RepairTicketStatus = 'open' | 'resolved' | 'dismissed';

export interface RepairTicketRow extends Record<string, unknown> {
  id: string;
  run_id: string;
  seq: number;
  keyword: string;
  reason: string;
  snapshot_path?: string;
  status: RepairTicketStatus;
  /** 解决时采用的规则版本号 */
  resolved_by_version?: number;
  created_at: string;
  updated_at: string;
}

/** 同一关键词只保留一张未决工单，避免反复失败刷屏 */
export function openRepairTicket(
  store: AppDataStore,
  input: { runId: string; seq: number; keyword: string; reason: string; snapshotPath?: string },
): void {
  const now = new Date().toISOString();
  const existing = store
    .query<RepairTicketRow>(REPAIR_TICKETS_COLLECTION, { filter: { status: 'open' } })
    .find((t) => t.keyword.toLowerCase() === input.keyword.toLowerCase());
  if (existing) {
    store.update<RepairTicketRow>(REPAIR_TICKETS_COLLECTION, existing.id, {
      run_id: input.runId,
      seq: input.seq,
      reason: input.reason,
      snapshot_path: input.snapshotPath,
      updated_at: now,
    });
    return;
  }
  store.create<RepairTicketRow>(REPAIR_TICKETS_COLLECTION, {
    run_id: input.runId,
    seq: input.seq,
    keyword: input.keyword,
    reason: input.reason,
    snapshot_path: input.snapshotPath,
    status: 'open',
    created_at: now,
    updated_at: now,
  } as unknown as RepairTicketRow);
}

export function listOpenRepairTickets(store: AppDataStore): RepairTicketRow[] {
  return store.query<RepairTicketRow>(REPAIR_TICKETS_COLLECTION, {
    filter: { status: 'open' },
    orderBy: { field: 'updated_at', direction: 'desc' },
  });
}

export function countOpenRepairTickets(store: AppDataStore): number {
  return store.count(REPAIR_TICKETS_COLLECTION, { status: 'open' });
}

/** 采用新规则版本时调用：所有未决工单标记为已解决 */
export function resolveOpenRepairTickets(store: AppDataStore, rulesVersion: number): number {
  const open = listOpenRepairTickets(store);
  const now = new Date().toISOString();
  for (const ticket of open) {
    store.update<RepairTicketRow>(REPAIR_TICKETS_COLLECTION, ticket.id, {
      status: 'resolved',
      resolved_by_version: rulesVersion,
      updated_at: now,
    });
  }
  return open.length;
}
