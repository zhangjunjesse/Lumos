import type { WorkflowDSLV3 } from './types-v3';
import type { IssueEmit } from './dsl-validator-types';

// ── 1. 节点 id 不得重复 ────────────────────────────────────────────────────

export function checkDuplicateIds(dsl: WorkflowDSLV3, emit: IssueEmit): void {
  const seen = new Set<string>();
  dsl.nodes.forEach((n, idx) => {
    if (seen.has(n.id)) {
      emit({
        severity: 'error',
        code: 'E_DUP_NODE_ID',
        nodeId: n.id,
        jsonPath: `nodes[${idx}].id`,
        message: `duplicate node id "${n.id}"`,
        hint: 'Rename one of the duplicates.',
      });
    }
    seen.add(n.id);
  });
}
