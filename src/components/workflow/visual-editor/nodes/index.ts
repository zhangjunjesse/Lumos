import { AgentNode } from './agent-node';
import { IfElseNode } from './if-else-node';
import { ForEachNode } from './for-each-node';
import { WhileNode } from './while-node';
import { WaitNode } from './wait-node';
import { NotificationNode } from './notification-node';
import { CapabilityNode } from './capability-node';

export { AgentNode, IfElseNode, ForEachNode, WhileNode, WaitNode, NotificationNode, CapabilityNode };

export const NODE_TYPES = {
  agent: AgentNode,
  'if-else': IfElseNode,
  'for-each': ForEachNode,
  while: WhileNode,
  wait: WaitNode,
  notification: NotificationNode,
  capability: CapabilityNode,
} as const;
