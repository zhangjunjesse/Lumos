// 聊天团队会话的一回合装配:团队+成员 → streamClaude 的 teamSession 参数。
// 队长=主会话(SDK 原生 agents 派单),协作方式全在 SOP 里;引擎只管组装和护栏。
// 执行/流式/落库/resume 全部复用 streamClaude(与普通聊天同一条被验证的通道)。
// 设计:docs/chat-team-design.md §5-6。

import type { ClaudeStreamOptions } from '@/types';
import { getProvider } from '@/lib/db/providers';
import { LUMOS_MCP_SERVER_NAME } from '@/lib/tools/lumos-mcp-server';
import { toAgentDefinitions } from './agent-defs';
import { buildTeamImageServerConfig } from './image-server-config';
import { createTeamImageGuard, releaseTeamImageGuard } from './image-guard';
import { getTeam } from './store';
import { buildRosterLines, resolveReadyMembers, TEAM_HARD_RULES, type ReadyMember } from './resolve-members';

// 每回合出图配额:聊天团队没有"目标张数"概念,给一个防失控的硬顶。
const IMAGES_PER_TURN_CAP = 10;

function buildLeaderSystemPrompt(teamName: string, sop: string, members: ReadyMember[]): string {
  return [
    `你是团队「${teamName}」的队长。用户在和整个团队对话:你负责理解用户诉求、把工作用 Task 工具派给团队成员(subagent_type 用成员名)、汇总产出、以团队名义向用户交差。`,
    '简单的寒暄或澄清问题你可以直接回答;实质工作必须派给成员完成,你自己不做成员职能内的活。',
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

export interface TeamChatTurn {
  streamOptions: ClaudeStreamOptions;
  /** 回合结束(流收完)后调用:释放出图配额注册表。 */
  release: () => void;
}

export function buildTeamChatTurn(input: {
  teamId: string;
  sessionId: string;
  sdkSessionId?: string;
  prompt: string;
  lumosUserId?: string;
  /** 用户在输入框选的服务商/模型:优先于团队配置(团队配置只是缺省值) */
  requestedProviderId?: string;
  requestedModel?: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  abortController?: AbortController;
  onRuntimeStatusChange?: (status: string) => void;
}): TeamChatTurn {
  const team = getTeam(input.teamId);
  if (!team) throw new Error('该会话绑定的团队已被删除——新建会话或先到「团队」页重建团队');

  const members = resolveReadyMembers(team);
  if (members.length === 0) {
    throw new Error(`团队「${team.name}」没有可用成员(启用且人设完整)——先到「团队」页配好成员`);
  }

  // 出图通道恒挂载(工具曝光由成员 tools 清单决定):挂载集合跨回合稳定,resume 不受影响。
  const runToken = createTeamImageGuard({ billingUserId: input.lumosUserId ?? '', cap: IMAGES_PER_TURN_CAP });

  // 模型选择:用户输入框所选 > 团队配置缺省 > 全局默认。指定的服务商不存在时回退并留痕。
  const effectiveProviderId = input.requestedProviderId?.trim() || team.providerId;
  const effectiveModel = input.requestedModel?.trim() || (effectiveProviderId === team.providerId ? team.model : '');
  const provider = effectiveProviderId ? getProvider(effectiveProviderId) : undefined;
  if (effectiveProviderId && !provider) {
    console.warn(`[team-chat] 团队「${team.name}」会话指定的服务商已不存在(${effectiveProviderId}),回退全局默认`);
  }

  return {
    streamOptions: {
      prompt: input.prompt,
      rawPrompt: input.prompt,
      sessionId: input.sessionId,
      sdkSessionId: input.sdkSessionId,
      systemPrompt: buildLeaderSystemPrompt(team.name, team.sop, members),
      ...(provider ? { provider } : {}),
      ...(effectiveModel ? { model: effectiveModel } : {}),
      conversationHistory: input.conversationHistory,
      abortController: input.abortController,
      onRuntimeStatusChange: input.onRuntimeStatusChange,
      teamSession: {
        agents: toAgentDefinitions(members.map((m) => m.spec)),
        tools: ['Task', 'Read'],
        sdkMcpServers: { [LUMOS_MCP_SERVER_NAME]: buildTeamImageServerConfig(runToken) },
      },
    },
    release: () => releaseTeamImageGuard(runToken),
  };
}
