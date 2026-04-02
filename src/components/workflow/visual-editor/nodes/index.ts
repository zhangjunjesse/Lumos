import { AgentNode } from './agent-node';
import { IfElseNode } from './if-else-node';
import { ForEachNode } from './for-each-node';
import { WhileNode } from './while-node';

export { AgentNode, IfElseNode, ForEachNode, WhileNode };

export const NODE_TYPES = {
  agent: AgentNode,
  'if-else': IfElseNode,
  'for-each': ForEachNode,
  while: WhileNode,
} as const;
