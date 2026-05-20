/**
 * discover-lifecycle: 选品研究记录的取消注册表 + 批量删除（cancel-then-delete）。
 * 用内存版 storage 替身验证生命周期副作用。
 */
interface Row {
  id: string;
  status: 'researching' | 'ready' | 'failed' | 'promoted';
  research_id: string;
  promoted_input_id?: string | null;
}

const rows = new Map<string, Row>();
/** 活的 product_inputs（promoted 候选的下游）。不在此集合 = 孤儿 promoted。 */
const inputs = new Set<string>();
const evidence = new Set<string>();

jest.mock('../storage', () => ({
  getEcommerceStore: () => ({
    delete: (_collection: string, id: string) => rows.delete(id),
  }),
  listCandidates: (_s: unknown, filter?: { research_id?: string }) =>
    [...rows.values()].filter((r) => !filter || r.research_id === filter.research_id),
  getCandidate: (_s: unknown, id: string) => rows.get(id) ?? null,
  getInput: (_s: unknown, id: string) => (inputs.has(id) ? { id } : null),
}));

jest.mock('../discover-evidence-storage', () => ({
  deleteSelectionEvidenceByResearchId: (_s: unknown, researchId: string) => {
    const existed = evidence.delete(researchId);
    return existed ? 1 : 0;
  },
}));

import {
  abortDiscoverRun,
  deleteResearchRunsByIds,
  isDiscoverRunRunning,
  registerDiscoverRun,
  unregisterDiscoverRun,
} from '../discover-lifecycle';

const REGISTRY_KEY = '__lumos_ecommerce_discover_registry';

function seed(
  id: string,
  research_id: string,
  status: Row['status'],
  promoted_input_id?: string,
) {
  rows.set(id, { id, research_id, status, promoted_input_id });
}

function seedEvidence(researchId: string) {
  evidence.add(researchId);
}

describe('discover-lifecycle', () => {
  beforeEach(() => {
    rows.clear();
    inputs.clear();
    evidence.clear();
    (globalThis as Record<string, unknown>)[REGISTRY_KEY] = undefined;
  });

  it('registerDiscoverRun is idempotent per id; unregister frees it', () => {
    const c1 = registerDiscoverRun('r-1');
    expect(c1).not.toBeNull();
    expect(isDiscoverRunRunning('r-1')).toBe(true);
    expect(registerDiscoverRun('r-1')).toBeNull(); // already running
    unregisterDiscoverRun('r-1');
    expect(isDiscoverRunRunning('r-1')).toBe(false);
    expect(registerDiscoverRun('r-1')).not.toBeNull();
  });

  it('abortDiscoverRun is a no-op (false) when nothing is running', () => {
    expect(abortDiscoverRun('ghost')).toBe(false);
  });

  describe('deleteResearchRunsByIds', () => {
    it('deletes every candidate of the given research_ids (placeholder + ready + failed)', () => {
      seed('p1', 'r1', 'researching'); // 研究中… 占位
      seed('a1', 'r1', 'ready');
      seed('a2', 'r1', 'failed');
      seed('b1', 'r2', 'ready');
      seed('keep', 'r3', 'ready'); // 未选中
      seedEvidence('r1');
      seedEvidence('r2');
      seedEvidence('r3');

      const res = deleteResearchRunsByIds(['r1', 'r2']);

      expect(res).toEqual({ removedRuns: 2, removedCandidates: 4, skippedPromoted: 0 });
      expect(rows.has('keep')).toBe(true);
      expect([...rows.keys()]).toEqual(['keep']);
      expect([...evidence].sort()).toEqual(['r3']);
    });

    it('skips only live-promoted (downstream product_input exists); all-live-promoted run not removed', () => {
      inputs.add('in-a2');
      inputs.add('in-b1');
      seed('a1', 'r1', 'ready');
      seed('a2', 'r1', 'promoted', 'in-a2'); // 活 product_input → 保护
      seed('b1', 'r2', 'promoted', 'in-b1'); // 整个 run 全活 promoted
      seedEvidence('r1');
      seedEvidence('r2');

      const res = deleteResearchRunsByIds(['r1', 'r2']);

      expect(res).toEqual({ removedRuns: 1, removedCandidates: 1, skippedPromoted: 2 });
      expect(rows.has('a1')).toBe(false);
      expect(rows.has('a2')).toBe(true);
      expect(rows.has('b1')).toBe(true);
      expect([...evidence].sort()).toEqual(['r1', 'r2']);
    });

    it('deletes orphan-promoted (product_input gone, or no promoted_input_id) — the dead-end bug fix', () => {
      seed('a1', 'r1', 'promoted', 'in-gone'); // promoted_input_id 指向已被删的 input
      seed('a2', 'r1', 'promoted'); // promoted 但无 promoted_input_id
      seed('a3', 'r1', 'ready');
      seedEvidence('r1');
      // inputs 为空 → in-gone 解析不到 → a1/a2 都是孤儿，应正常删

      const res = deleteResearchRunsByIds(['r1']);

      expect(res).toEqual({ removedRuns: 1, removedCandidates: 3, skippedPromoted: 0 });
      expect(rows.size).toBe(0);
      expect(evidence.size).toBe(0);
    });

    it('dedupes ids and skips blank / unknown ones', () => {
      seed('a1', 'r1', 'ready');

      const res = deleteResearchRunsByIds(['r1', 'r1', '  ', 'ghost']);

      expect(res).toEqual({ removedRuns: 1, removedCandidates: 1, skippedPromoted: 0 });
    });

    it('handles legacy-<candidateId> ids (no research_id) by single-row lookup', () => {
      seed('legacyCand', '', 'ready'); // 旧数据无 research_id

      const res = deleteResearchRunsByIds(['legacy-legacyCand']);

      expect(res).toEqual({ removedRuns: 1, removedCandidates: 1, skippedPromoted: 0 });
      expect(rows.has('legacyCand')).toBe(false);
    });

    it('aborts a live controller before deleting (cancel-then-delete)', () => {
      const controller = registerDiscoverRun('r1')!;
      seed('a1', 'r1', 'researching');

      const res = deleteResearchRunsByIds(['r1']);

      expect(controller.signal.aborted).toBe(true);
      expect(isDiscoverRunRunning('r1')).toBe(false);
      expect(res.removedCandidates).toBe(1);
      expect(rows.has('a1')).toBe(false);
    });

    it('empty / all-invalid input deletes nothing', () => {
      expect(deleteResearchRunsByIds([])).toEqual({
        removedRuns: 0,
        removedCandidates: 0,
        skippedPromoted: 0,
      });
      expect(deleteResearchRunsByIds(['ghost', ' '])).toEqual({
        removedRuns: 0,
        removedCandidates: 0,
        skippedPromoted: 0,
      });
    });
  });
});
