// 聊天团队会话:把团队+成员装配成 streamClaude 的 teamSession 参数 + 队长系统提示词。
import { resolveImageProviderId } from '@/lib/image/image-provider-resolver';
import { sanitizeImageProviderId } from '@/lib/image/image-provider-hint';
// 关键:团队会话走普通聊天的同一条装配链(MCP/skill/能力全继承),这里只产出团队特有的
// 叠加件——队长提示词、成员 agents、出图 stdio server、团队级模型覆盖。设计:docs/chat-team-design.md §5-6。

import type { ApiProvider } from '@/types';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { getProvider } from '@/lib/db/providers';
import { LUMOS_MCP_SERVER_NAME } from '@/lib/tools/lumos-mcp-server';
import { toAgentDefinitions } from './agent-defs';
import { buildTeamImageServerConfig } from './image-server-config';
import { createTeamImageGuard, releaseTeamImageGuard } from './image-guard';
import { getTeam } from './store';
import { buildRosterLines, resolveReadyMembers, TEAM_HARD_RULES, type ReadyMember } from './resolve-members';

// 只用来兜住 agent 死循环刷图,不是产品意义上的配额;正常回合不该撞到。
const IMAGES_PER_TURN_CAP = 999;

function buildLeaderSystemPrompt(teamName: string, sop: string, members: ReadyMember[]): string {
  return [
    `你是团队「${teamName}」的队长。用户在和整个团队对话:你负责理解用户诉求、把工作用 Task 工具派给团队成员(subagent_type 用成员名)、汇总产出、以团队名义向用户交差。`,
    '简单的寒暄或澄清问题你可以直接回答;实质工作必须派给成员完成,你自己不做成员职能内的活。',
    '团队成员和你一样能用本会话的全部工具(读文件/网络搜索/浏览器/知识库/office 文档/出图等);派单时把要用哪些工具、目标、约束写清楚。',
    '',
    '团队成员(职能是你派单的依据):',
    buildRosterLines(members),
    '',
    sop.trim() ? `===== 团队 SOP(按此工作) =====\n${sop.trim()}` : '(该团队没有写 SOP:你自行安排最合理的分工完成任务。)',
    '',
    ...TEAM_HARD_RULES,
    '- 最终向用户交差用清晰的自然语言,说明每部分是哪位成员的产出。',
  ].join('\n');
}

export interface TeamChatConfig {
  /** 队长系统提示词(替换普通人设;能力发现提示由 route 另行拼接)。 */
  leaderSystemPrompt: string;
  /** streamClaude 的 teamSession 参数:成员 agents + 出图 stdio server。 */
  teamSession: {
    agents: NonNullable<import('@anthropic-ai/claude-agent-sdk').Options['agents']>;
    sdkMcpServers: Record<string, McpServerConfig>;
  };
  /** 团队级模型覆盖(用户输入框所选优先,团队配置为缺省)。 */
  provider?: ApiProvider;
  model?: string;
  /** 回合结束后调用:释放出图配额注册表。 */
  release: () => void;
}

export function buildTeamChatConfig(input: {
  teamId: string;
  lumosUserId?: string;
  /** 用户在输入框选的服务商/模型:优先于团队配置(团队配置只是缺省值) */
  requestedProviderId?: string;
  requestedModel?: string;
}): TeamChatConfig {
  const team = getTeam(input.teamId);
  if (!team) throw new Error('该会话绑定的团队已被删除——新建会话或先到「团队」页重建团队');

  const members = resolveReadyMembers(team);
  if (members.length === 0) {
    throw new Error(`团队「${team.name}」没有可用成员(启用且人设完整)——先到「团队」页配好成员`);
  }

  // 团队级图片服务商:团队默认 → 全局默认(就近原则)。成员级细分见 T3.2 第二批。
  const teamImageProviderId = resolveImageProviderId({
    hasTeam: true,
    teamDefaultImageProviderId: sanitizeImageProviderId(team.defaultImageProviderId, '团队默认'),
  });
  const runToken = createTeamImageGuard({
    billingUserId: input.lumosUserId ?? '',
    cap: IMAGES_PER_TURN_CAP,
    imageProviderId: teamImageProviderId,
  });

  // 模型选择:用户输入框所选 > 团队配置缺省 > 全局默认。指定的服务商不存在时回退并留痕。
  const effectiveProviderId = input.requestedProviderId?.trim() || team.providerId;
  const effectiveModel = input.requestedModel?.trim() || (effectiveProviderId === team.providerId ? team.model : '');
  const provider = effectiveProviderId ? getProvider(effectiveProviderId) : undefined;
  if (effectiveProviderId && !provider) {
    console.warn(`[team-chat] 团队「${team.name}」会话指定的服务商已不存在(${effectiveProviderId}),回退全局默认`);
  }

  return {
    leaderSystemPrompt: buildLeaderSystemPrompt(team.name, team.sop, members),
    teamSession: {
      agents: toAgentDefinitions(members.map((m) => m.spec)),
      sdkMcpServers: { [LUMOS_MCP_SERVER_NAME]: buildTeamImageServerConfig(runToken) },
    },
    ...(provider ? { provider } : {}),
    ...(effectiveModel ? { model: effectiveModel } : {}),
    release: () => releaseTeamImageGuard(runToken),
  };
}
