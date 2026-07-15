// 团队成员解析(平台通用):引用→就绪成员(人设完整且启用),含派单花名册与 AgentSpec。
// 聊天团队会话与工作流团队步骤共用,保证两处对成员的理解完全一致。

import { agentKeyOf, type TeamAgentSpec } from './agent-defs';
import { grantsToTools } from './tool-grants';
import { resolveTeamMembers, type PlatformTeam } from './store';

export interface ReadyMember {
  name: string;
  duty: string;
  spec: TeamAgentSpec;
}

export function resolveReadyMembers(team: PlatformTeam): ReadyMember[] {
  return resolveTeamMembers(team)
    .filter((m) => m.ref.enabled && m.preset && m.preset.systemPrompt.trim())
    .map((m) => {
      const p = m.preset!;
      const duty = p.responsibility?.trim() || p.position?.trim() || p.description?.trim() || '团队成员';
      return {
        name: p.name,
        duty,
        spec: {
          key: agentKeyOf(p.name),
          description: `${p.name}:${duty}`,
          prompt: p.systemPrompt,
          tools: grantsToTools(p.toolPermissions),
        },
      };
    });
}

export function buildRosterLines(members: ReadyMember[]): string {
  return members.map((m) => `- ${m.spec.key}:${m.duty}`).join('\n');
}

/** 硬纪律(队长提示词压轴段,聊天/工作流共用;防被 SOP 冲掉) */
export const TEAM_HARD_RULES = [
  '===== 硬纪律(优先级高于 SOP,不可违背) =====',
  '- 你唯一合法的协作方式是真实调用 Task 工具(subagent_type=成员名)。严禁自己扮演成员、严禁代写"成员产出":没有对应 Task 调用却声称某成员产出了什么,属于造假,是最严重的违纪。',
  '- 派单必须合批:同类工作一次派单批量完成,严禁把一件事拆成多次小派单;每个成员一回合至多派单 2 次。',
  '- 派单的任务文本必须自包含:成员看不到原始任务和别人的产出,它需要的一切信息(任务要点/上游成员产出/约束)都要原文写进任务里。',
  '- 如实交差:成员失败就说失败,不编造产出;引用成员的结论时忠实转述,不添油加醋。',
];
