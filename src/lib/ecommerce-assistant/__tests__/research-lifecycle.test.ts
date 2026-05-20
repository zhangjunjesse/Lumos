/**
 * research-lifecycle: 取消 / 终态对账 / 删除前取消。
 * 用内存版 research-storage 替身验证生命周期副作用。
 */
interface Row {
  id: string;
  status: string;
  stage?: string | null;
  error?: string | null;
  failure_stage?: string | null;
  completed_at?: string | null;
}

const rows = new Map<string, Row>();

jest.mock('../research-storage', () => ({
  getResearchStore: () => ({}),
  getResearchReport: (_s: unknown, id: string) => rows.get(id) ?? null,
  listResearchReports: (_s: unknown, f: { status?: string }) =>
    [...rows.values()].filter((r) => !f.status || r.status === f.status),
  patchResearchReport: (_s: unknown, id: string, patch: Partial<Row>) => {
    const cur = rows.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    rows.set(id, next);
    return next;
  },
  deleteResearchReport: (_s: unknown, id: string) => rows.delete(id),
}));

import {
  abortRun,
  cancelReport,
  deleteReportsByIds,
  deleteReportWithCancel,
  isReportRunning,
  cleanupReports,
  reconcileOrphans,
  registerRun,
  unregisterRun,
} from '../research-lifecycle';

const REGISTRY_KEY = '__lumos_ecommerce_research_registry';

describe('research-lifecycle', () => {
  beforeEach(() => {
    rows.clear();
    (globalThis as Record<string, unknown>)[REGISTRY_KEY] = undefined;
  });

  it('registerRun is idempotent per id; unregister frees it', () => {
    const c1 = registerRun('r-1');
    expect(c1).not.toBeNull();
    expect(isReportRunning('r-1')).toBe(true);
    expect(registerRun('r-1')).toBeNull(); // already running
    unregisterRun('r-1');
    expect(isReportRunning('r-1')).toBe(false);
    expect(registerRun('r-1')).not.toBeNull();
  });

  it('reconcileOrphans marks controller-less running/queued rows failed/interrupted', () => {
    rows.set('a', { id: 'a', status: 'running' });
    rows.set('b', { id: 'b', status: 'queued' });
    rows.set('c', { id: 'c', status: 'completed' });
    registerRun('a'); // a has a live controller → not an orphan

    const fixed = reconcileOrphans();

    expect(fixed).toBe(1);
    expect(rows.get('a')!.status).toBe('running'); // live, untouched
    expect(rows.get('b')!.status).toBe('failed');
    expect(rows.get('b')!.failure_stage).toBe('interrupted');
    expect(rows.get('c')!.status).toBe('completed'); // terminal, untouched
  });

  it('cancelReport aborts a live run and returns true (row left for runner)', () => {
    const controller = registerRun('live')!;
    rows.set('live', { id: 'live', status: 'running' });

    expect(cancelReport('live')).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    // lifecycle 不替 runner 写行；runner 的 finally 负责写 cancelled。
    expect(rows.get('live')!.status).toBe('running');
  });

  it('cancelReport reconciles a zombie (no controller, non-terminal) to cancelled', () => {
    rows.set('z', { id: 'z', status: 'running' });
    expect(isReportRunning('z')).toBe(false);

    expect(cancelReport('z')).toBe(true);
    expect(rows.get('z')!.status).toBe('cancelled');
    expect(rows.get('z')!.failure_stage).toBe('cancelled');
  });

  it('cancelReport returns false for terminal or missing rows', () => {
    rows.set('done', { id: 'done', status: 'completed' });
    expect(cancelReport('done')).toBe(false);
    expect(cancelReport('nope')).toBe(false);
  });

  it('deleteReportWithCancel aborts the live controller then deletes the row', () => {
    const controller = registerRun('d')!;
    rows.set('d', { id: 'd', status: 'running' });

    expect(deleteReportWithCancel('d')).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(isReportRunning('d')).toBe(false);
    expect(rows.has('d')).toBe(false);
  });

  it('abortRun is a no-op (false) when nothing is running', () => {
    expect(abortRun('ghost')).toBe(false);
  });

  describe('cleanupReports', () => {
    beforeEach(() => {
      rows.set('f1', { id: 'f1', status: 'failed' });
      rows.set('f2', { id: 'f2', status: 'failed' });
      rows.set('c1', { id: 'c1', status: 'cancelled' });
      rows.set('done', { id: 'done', status: 'completed' });
      rows.set('run', { id: 'run', status: 'running' });
      rows.set('q', { id: 'q', status: 'queued' });
    });

    it('default removes only failed + cancelled; never completed/running/queued', () => {
      const removed = cleanupReports();
      expect(removed).toBe(3);
      expect(rows.has('f1')).toBe(false);
      expect(rows.has('f2')).toBe(false);
      expect(rows.has('c1')).toBe(false);
      expect(rows.has('done')).toBe(true);
      expect(rows.has('run')).toBe(true);
      expect(rows.has('q')).toBe(true);
    });

    it('honors an explicit status subset', () => {
      const removed = cleanupReports(['failed']);
      expect(removed).toBe(2);
      expect(rows.has('c1')).toBe(true); // cancelled untouched
    });

    it('all-illegal status list removes nothing (no escalation to delete-all)', () => {
      const removed = cleanupReports(['completed', 'running', 'garbage']);
      // 破坏性操作取保守：没有合法可清理 status → 删 0，绝不升级成全删
      expect(removed).toBe(0);
      expect(rows.has('f1')).toBe(true);
      expect(rows.has('c1')).toBe(true);
      expect(rows.has('done')).toBe(true);
    });

    it('aborts a live controller before deleting a failed-status zombie row', () => {
      const controller = registerRun('f1')!;
      cleanupReports(['failed']);
      expect(controller.signal.aborted).toBe(true);
      expect(rows.has('f1')).toBe(false);
    });
  });

  describe('deleteReportsByIds', () => {
    beforeEach(() => {
      rows.set('done', { id: 'done', status: 'completed' });
      rows.set('f1', { id: 'f1', status: 'failed' });
      rows.set('run', { id: 'run', status: 'running' });
    });

    it('deletes exactly the given ids regardless of status (incl. completed)', () => {
      // 区别于 cleanup：显式勾选即用户意图，已完成产出也能删
      const removed = deleteReportsByIds(['done', 'f1']);
      expect(removed).toBe(2);
      expect(rows.has('done')).toBe(false);
      expect(rows.has('f1')).toBe(false);
      expect(rows.has('run')).toBe(true); // 未勾选的不动
    });

    it('dedupes ids and skips blank / unknown ones', () => {
      const removed = deleteReportsByIds(['done', 'done', '  ', 'ghost']);
      expect(removed).toBe(1);
      expect(rows.has('done')).toBe(false);
    });

    it('aborts a live controller before deleting (cancel-then-delete)', () => {
      const controller = registerRun('run')!;
      deleteReportsByIds(['run']);
      expect(controller.signal.aborted).toBe(true);
      expect(isReportRunning('run')).toBe(false);
      expect(rows.has('run')).toBe(false);
    });

    it('empty / all-invalid input deletes nothing', () => {
      expect(deleteReportsByIds([])).toBe(0);
      expect(deleteReportsByIds(['ghost', ' '])).toBe(0);
      expect(rows.size).toBe(3);
    });
  });
});
