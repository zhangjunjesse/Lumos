/**
 * 切换内置 `x-platform` MCP 的启用状态(lumos.db)。
 *
 * x-platform 默认关闭(init-builtin-resources.ts 故意没把它加进自动启用列表):
 * 它的工具需要登录 X 才有用,未登录就启用会让每个 Agent 上下文充斥「未登录」
 * 报错。因此和 goofish 一样,由 X 登录/登出流程按 cookie 状态翻这个开关。
 */

import { getMcpServerByNameAndScope, toggleMcpServerEnabled } from '@/lib/db/mcp-servers';

const X_MCP = 'x-platform';

export function getXMcpEnabled(): boolean | null {
  const record = getMcpServerByNameAndScope(X_MCP, 'builtin');
  if (!record) return null;
  return Boolean(record.is_enabled);
}

/** 幂等:已是目标状态则不写库。记录不存在(未 init)返回 false。 */
export function setXMcpEnabled(enabled: boolean): boolean {
  const record = getMcpServerByNameAndScope(X_MCP, 'builtin');
  if (!record) return false;
  if (Boolean(record.is_enabled) === enabled) return true;
  return toggleMcpServerEnabled(record.id, enabled);
}
