// 团队出图 stdio MCP 的进程配置(平台通用):内置脚本 + 打包 node 运行时。
// 出图走 stdio+HTTP 回调而非进程内 MCP——控制协议在复杂多子代理会话里必断(实测)。
// 挂载名固定 LUMOS_MCP_SERVER_NAME,工具名与聊天进程内版完全一致(提示词/解析零改动)。

import path from 'node:path';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { resolveRuntimeResourcePath } from '@/lib/runtime-resources';
import { resolveMcpRuntimeCommand } from '@/lib/mcp-runtime-command';

const IMAGE_CALL_TIMEOUT_MS = 900_000; // generate_image 单次 50-100s+,批量 count>1 更久

export function buildTeamImageServerConfig(runToken: string): NonNullable<Options['mcpServers']>[string] {
  const script = resolveRuntimeResourcePath(path.join('mcp-servers', 'team-image', 'team_image_mcp.mjs'));
  if (!script) throw new Error('找不到 team-image MCP 脚本(runtime resources 未就绪)');
  const apiBase = process.env.LUMOS_API_BASE
    || `http://localhost:${process.env.LUMOS_DEV_SERVER_PORT || process.env.PORT || '3000'}`;
  return {
    type: 'stdio',
    command: resolveMcpRuntimeCommand({ command: 'node', runtime: 'node' }),
    args: [script],
    env: { LUMOS_API_BASE: apiBase, LUMOS_TEAM_RUN_TOKEN: runToken },
    timeout: IMAGE_CALL_TIMEOUT_MS,
  };
}
