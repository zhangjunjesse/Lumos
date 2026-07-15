import { AgentNode } from './agent-node';
import { TeamNode } from './team-node';
import { IfElseNode } from './if-else-node';
import { ForEachNode } from './for-each-node';
import { WhileNode } from './while-node';
import { WaitNode } from './wait-node';
import { NotificationNode } from './notification-node';
import { CapabilityNode } from './capability-node';
import { ParallelNode } from './parallel-node';
import { JoinNode } from './join-node';
import { ApprovalNode } from './approval-node';

export {
  AgentNode,
  TeamNode,
  IfElseNode,
  ForEachNode,
  WhileNode,
  WaitNode,
  NotificationNode,
  CapabilityNode,
  ParallelNode,
  JoinNode,
  ApprovalNode,
};

export const NODE_TYPES = {
  agent: AgentNode,
  team: TeamNode,
  'if-else': IfElseNode,
  'for-each': ForEachNode,
  while: WhileNode,
  wait: WaitNode,
  notification: NotificationNode,
  capability: CapabilityNode,
  parallel: ParallelNode,
  join: JoinNode,
  approval: ApprovalNode,
} as const;
