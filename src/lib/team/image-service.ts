// 团队出图 HTTP 回调的业务逻辑(平台通用):token 校验 → 配额 → 复用聊天同一套出图核心 → 记录真实路径。
// 调用方是 team-image stdio MCP 进程(见 resources/mcp-servers/team-image),route 层只做参数解析(/api/team/image)。

import { runImageGen, type ImageGenArgs } from '@/lib/tools/image-gen-tool';
import { resolveImageProviderId } from '@/lib/image/image-provider-resolver';
import { sanitizeImageProviderId } from '@/lib/image/image-provider-hint';
import { getTeamImageGuard, type TeamImageGuard } from './image-guard';
import { getTeam } from './store';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }) }], isError: true };
}

/**
 * 出图时现解析团队默认服务商:轮次开始后用户在界面改了团队服务商也立即生效。
 * 团队记录已删(极端)或旧 guard 没带 teamId 时,退回创建时快照的 imageProviderId。
 */
function resolveGuardImageProviderId(guard: TeamImageGuard): string | undefined {
  if (guard.teamId) {
    const team = getTeam(guard.teamId);
    if (team) {
      return resolveImageProviderId({
        hasTeam: true,
        teamDefaultImageProviderId: sanitizeImageProviderId(team.defaultImageProviderId, '团队默认'),
      });
    }
  }
  return guard.imageProviderId;
}

export async function handleTeamImageCall(token: string, args: ImageGenArgs): Promise<CallToolResult> {
  const guard = getTeamImageGuard(token);
  if (!guard) {
    return errorResult('本次团队出图会话已结束或不存在,不能再出图——用已有产出交差。');
  }

  // 配额先扣后生成(与旧 canUseTool 语义一致):按 count 计数,超额拒绝并让队长收口。
  const n = Math.max(1, Math.floor(Number(args.count ?? 1)));
  if (guard.used + n > guard.cap) {
    guard.onQuotaDenied?.(guard.used, guard.cap);
    return errorResult(`出图配额已用完(上限 ${guard.cap} 张),立即停止出图,用已有产出交差。`);
  }
  guard.used += n;

  // 团队级图片服务商;成员级细分见 T3.2 第二批。传 thunk:每次出图按 teamId
  // 现解析团队默认,用户轮次中途在界面切换团队服务商即时生效(#65)。
  const result = await runImageGen(
    args,
    undefined,
    guard.billingUserId || undefined,
    () => resolveGuardImageProviderId(guard),
  );

  // 从成功结果里记下真实落盘路径:最终交差的 path 必须在这个集合里(防幻觉路径)。
  for (const block of result.content ?? []) {
    if (block.type !== 'text' || typeof block.text !== 'string') continue;
    try {
      const payload = JSON.parse(block.text) as { images?: Array<{ path?: string }> };
      for (const img of payload.images ?? []) {
        if (typeof img?.path === 'string' && img.path) guard.producedPaths.add(img.path);
      }
    } catch { /* 错误文本不是 JSON——跳过 */ }
  }
  return result;
}
