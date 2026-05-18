/**
 * Agent 能力注册中心 — 公共入口。
 *
 * 真源文档：docs/agent-capability-registry.md
 * chat route 用 buildCapabilityPlan + buildDbServerHints；
 * init-builtin-resources 用 defaultEnabledDbMcpNames。
 */
export {
  buildCapabilityPlan,
  buildDbServerHints,
  buildAskModeAllowance,
  defaultEnabledDbMcpNames,
} from './registry';
export type {
  CapabilityPlan,
  ConnectorContext,
  ConnectorDefinition,
  ConnectorReadiness,
  PermissionMode,
} from './types';
