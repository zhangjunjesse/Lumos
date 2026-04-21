import type { Block } from './compiler-v3-blocks';
import { emitLiteral } from './compiler-helpers';
import { emitLeaf } from './compiler-v3-emit-leaf';
import {
  emitIfElse,
  emitLoop,
  emitParallel,
  type ControlEmitContext,
} from './compiler-v3-emit-control';
import type { WorkflowNode } from './types-v3';

// ── Main dispatch: block → JS source ────────────────────────────────────────
//
// 纯文本发射器。调用方 (compiler-v3 entry) 负责准备 nodeById 映射和
// outer-state 表达式 (`undefined` 或 `__state_xxx`)。

export interface EmitContext {
  nodeById: Map<string, WorkflowNode>;
  outerStateExpr: string;
}

export function emitBlock(block: Block, ctx: EmitContext, indent: number): string {
  return emitBlockWithState(block, ctx, ctx.outerStateExpr, indent);
}

function emitBlockWithState(block: Block, ctx: EmitContext, stateExpr: string, indent: number): string {
  const emitted = (() => {
    switch (block.kind) {
    case 'leaf': {
      const node = ctx.nodeById.get(block.nodeId);
      if (!node) throw new Error(`emitBlock: unknown node "${block.nodeId}"`);
      return emitLeaf(node, { outerStateExpr: stateExpr }, indent);
    }
    case 'sequence':
      return block.steps.map((s) => emitBlockWithState(s, ctx, stateExpr, indent)).join('\n\n');
    case 'if-else': {
      const head = requireNode(ctx.nodeById, block.head);
      const controlCtx: ControlEmitContext = {
        emitBlock: (b, st, ind) => emitBlockWithState(b, ctx, st, ind),
        outerStateExpr: stateExpr,
      };
      return emitIfElse(head, block.thenBlock, block.elseBlock, controlCtx, indent);
    }
    case 'loop': {
      const head = requireNode(ctx.nodeById, block.head);
      const controlCtx: ControlEmitContext = {
        emitBlock: (b, st, ind) => emitBlockWithState(b, ctx, st, ind),
        outerStateExpr: stateExpr,
      };
      return emitLoop(head, block.body, controlCtx, indent);
    }
    case 'parallel': {
      const head = requireNode(ctx.nodeById, block.head);
      const controlCtx: ControlEmitContext = {
        emitBlock: (b, st, ind) => emitBlockWithState(b, ctx, st, ind),
        outerStateExpr: stateExpr,
      };
      return emitParallel(head, block.join, block.branches, controlCtx, indent);
    }
    }
  })();

  if (block.kind === 'leaf') {
    return emitted;
  }

  const pad = ' '.repeat(indent);
  const nodeIds = emitLiteral(collectBlockNodeIds(block));
  return [
    `${pad}if (__shouldSkipBlock(${nodeIds})) {`,
    `${pad}  // Skip the entire control-flow block while replaying to a goto target.`,
    `${pad}} else {`,
    emitted,
    `${pad}}`,
  ].join('\n');
}

function requireNode(map: Map<string, WorkflowNode>, id: string): WorkflowNode {
  const n = map.get(id);
  if (!n) throw new Error(`emitBlock: unknown node "${id}"`);
  return n;
}

function collectBlockNodeIds(block: Block): string[] {
  switch (block.kind) {
    case 'leaf':
      return [block.nodeId];
    case 'sequence':
      return block.steps.flatMap((step) => collectBlockNodeIds(step));
    case 'if-else':
      return [block.head, ...collectBlockNodeIds(block.thenBlock), ...collectBlockNodeIds(block.elseBlock)];
    case 'loop':
      return [block.head, ...collectBlockNodeIds(block.body)];
    case 'parallel':
      return [block.head, block.join, ...block.branches.flatMap((branch) => collectBlockNodeIds(branch))];
  }
}
