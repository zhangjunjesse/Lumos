/**
 * MCP 工具调用失败的诊断增强(#57)。
 *
 * 症结:底层 MCP server 没连上时,SDK 报的是 "No such tool available: mcp__x__y"。
 * 这句话暗示"工具不存在",于是排查方向被引向注册表——而注册表往往一切正常
 * (is_enabled=1、health_status=ok、工具声明也在模型清单里),真正的问题在连接层。
 * 实测有人为此白查半天,最后工具还自己好了。
 *
 * 我们改不了 SDK 的原文(它在 CLI 内部生成),但可以在把结果发给用户之前,
 * 附上这一轮 init 里拿到的真实连接态——让"到底是没这个工具,还是没连上"
 * 一眼可辨。纯函数,不碰会话链路。
 */

/** SDK init 消息里给的每个 MCP server 连接态 */
export interface McpServerStatusSnapshot {
  name: string;
  status: string;
}

/** SDK 报"工具不存在"的特征串(CLI 内部生成,只能按文本识别) */
const NO_SUCH_TOOL_PATTERN = /No such tool available:\s*(\S+)/i;

/** 从 mcp__<server>__<tool> 里取 server 名 */
export function parseMcpServerName(toolName: string): string | undefined {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(toolName.trim());
  return m?.[1];
}

const STATUS_HINT: Record<string, string> = {
  failed: '连接失败(进程未能启动或握手失败)',
  pending: '仍在启动中(本轮尚未就绪)',
  'needs-auth': '需要授权后才能连接',
  disabled: '已被禁用',
};

/**
 * 如果这条工具错误是"No such tool available",且能对上某个 MCP server 的
 * 非 connected 状态,就返回一段补充说明;否则返回 undefined(不改动原文)。
 */
export function buildMcpToolErrorDiagnostic(
  resultContent: string,
  mcpStatuses: McpServerStatusSnapshot[] | undefined,
): string | undefined {
  const matched = NO_SUCH_TOOL_PATTERN.exec(resultContent);
  if (!matched) return undefined;

  const toolName = matched[1];
  const serverName = parseMcpServerName(toolName);
  if (!serverName) return undefined;

  const status = mcpStatuses?.find((s) => s.name === serverName)?.status;

  // 连接态正常(或本轮没拿到状态)时不乱猜原因,只点明方向:工具清单里有、
  // 但这次调用没命中,通常是本轮会话的 MCP 连接与声明不同步。
  if (!status || status === 'connected') {
    return `\n\n[Lumos 诊断] MCP server "${serverName}" 本轮${status === 'connected' ? '显示已连接' : '连接状态未知'}。`
      + '若该工具确实已安装并启用,这多半是本轮会话的 MCP 连接与工具声明不同步,通常重试或新开会话即可恢复;'
      + '可查看 ~/.lumos/claude-runtime.log 里的 mcp_servers_connected / mcp_server_unavailable 记录确认。';
  }

  const hint = STATUS_HINT[status] || `状态为 ${status}`;
  return `\n\n[Lumos 诊断] 这不是"工具不存在",而是 MCP server "${serverName}" ${hint}。`
    + '工具声明在清单里、注册表也正常,但底层连接没就绪,所以调用被判成工具不可用。'
    + '可查看 ~/.lumos/claude-runtime.log 的 mcp_server_unavailable 记录,或到「插件 → MCP」重连该服务。';
}
