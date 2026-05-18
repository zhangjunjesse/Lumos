/**
 * 连接器注册表聚合。新增连接器只需在此 append——注册即契约。
 *
 * 真源文档：docs/agent-capability-registry.md
 */
import type { ConnectorDefinition } from '../types';
import { wechatConnector } from './wechat';
import { dbConnectors } from './db-connectors';
import { inProcessConnectors } from './in-process-connectors';

export const CONNECTORS: ConnectorDefinition[] = [
  wechatConnector,
  ...dbConnectors,
  ...inProcessConnectors,
];
