/**
 * 工作流 AI 助手的平台团队只读工具。
 *
 * 只读是有意的:团队增删改、成员启停在「团队」页面做,助手不代劳——改团队会同时影响
 * 聊天团队会话和其他工作流,不该是编排一条工作流的副作用。助手该做的是选对团队、把
 * teamId 写进 DSL 的 team 节点。
 */
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { resolveReadyMembers } from '@/lib/team/resolve-members';
import { listTeams, type PlatformTeam } from '@/lib/team/store';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

function summarizeTeam(team: PlatformTeam): Record<string, unknown> {
  const ready = resolveReadyMembers(team);
  return {
    id: team.id,
    name: team.name,
    ...(team.description ? { description: team.description } : {}),
    ...(team.sop ? { sop: team.sop } : {}),
    readyMembers: ready.length,
    // 声明了却不可用的引用(人设被删或停用):团队看着有人、实际派不出单,必须让助手看见。
    unavailableMembers: Math.max(0, team.memberRefs.length - ready.length),
    roster: ready.map((m) => ({ name: m.name, duty: m.duty })),
    usable: ready.length > 0,
  };
}

export function createListWorkflowTeamsTool() {
  return tool(
    'list_workflow_teams',
    '列出平台 AI 团队(id、name、SOP、就绪成员花名册)。工作流 team 节点的 teamId 必须来自这里。'
    + '当用户说“这一步交给某个团队”“用团队做 XX”“有哪些团队”时,先调这个工具拿最新名单,'
    + '不要依赖系统提示词里的静态快照。注意:团队(队长按 SOP 派单成员协作)和部门'
    + '(department,只是 agent 的分组标签)是两回事,不要混。',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const teams = listTeams();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              total: teams.length,
              teams: teams.map(summarizeTeam),
              ...(teams.length === 0
                ? { hint: '当前没有平台团队。请让用户先去「团队」页面创建团队、添加成员,之后才能使用 team 节点。' }
                : {}),
            }, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
