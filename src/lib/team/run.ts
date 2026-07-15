// 一次性团队任务执行(平台通用,工作流团队步骤用):队长按 SOP 派单成员完成任务,
// 返回最终交差文本 + 执行事件。与聊天团队会话同一套成员解析/工具授权/出图护栏,
// 差别只在:无会话状态(不 resume)、任务一次给全、交差即结束。
// 装配纪律同 docs/chat-team-design.md §5.2(bypass+声明式工具面,不走控制协议回调)。

import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildClaudeSdkInvocationContext } from '@/lib/claude/sdk-runtime';
import { isClaudeLocalAuthProvider } from '@/lib/claude/provider-env';
import { ensureClaudeLocalAuthReady } from '@/lib/claude/local-auth';
import { getProvider } from '@/lib/db/providers';
import { LUMOS_MCP_SERVER_NAME } from '@/lib/tools/lumos-mcp-server';
import { toAgentDefinitions } from './agent-defs';
import { buildTeamImageServerConfig } from './image-server-config';
import { createTeamImageGuard, releaseTeamImageGuard } from './image-guard';
import { getTeam } from './store';
import { buildRosterLines, resolveReadyMembers, TEAM_HARD_RULES, type ReadyMember } from './resolve-members';

const TASK_TIMEOUT_MS = 1_800_000; // 30min:多成员串并混合给足;超时不吞产出,拿已有文本交差
const MAX_TURNS = 40;
const IMAGES_PER_TASK_CAP = 10;

export interface TeamTaskEvent {
  kind: 'dispatch' | 'done';
  to?: string;
  subtype?: string;
  turns?: number;
}

export interface TeamTaskResult {
  text: string;
  dispatches: number;
  dispatchedTo: string[];
  subtype: string;
}

function buildTaskLeaderPrompt(teamName: string, sop: string, members: ReadyMember[], task: string): string {
  return [
    `你是团队「${teamName}」的队长。这是一个自动化任务(无人在线对话):理解任务,把工作用 Task 工具派给团队成员(subagent_type 用成员名),汇总产出,以一段完整的最终交付文本收尾。`,
    '你的最后一条消息就是交付物本身——写全,不要以提问或"接下来我将…"结尾。',
    '',
    '团队成员(职能是你派单的依据):',
    buildRosterLines(members),
    '',
    sop.trim() ? `===== 团队 SOP(按此工作) =====\n${sop.trim()}` : '(该团队没有写 SOP:你自行安排最合理的分工完成任务。)',
    '',
    ...TEAM_HARD_RULES,
    '',
    '===== 任务 =====',
    task,
  ].join('\n');
}

export async function runTeamTask(input: {
  teamId: string;
  task: string;
  lumosUserId?: string;
  timeoutMs?: number;
  onEvent?: (ev: TeamTaskEvent) => void;
}): Promise<TeamTaskResult> {
  const team = getTeam(input.teamId);
  if (!team) throw new Error('团队不存在或已被删除');
  const members = resolveReadyMembers(team);
  if (members.length === 0) throw new Error(`团队「${team.name}」没有可用成员(启用且人设完整)`);

  const emit = (ev: TeamTaskEvent) => {
    try { input.onEvent?.(ev); } catch { /* 事件回调异常不影响执行 */ }
  };

  const provider = team.providerId ? getProvider(team.providerId) : undefined;
  if (team.providerId && !provider) {
    console.warn(`[team-run] 团队「${team.name}」指定的服务商已不存在(${team.providerId}),回退全局默认`);
  }
  const runtime = buildClaudeSdkInvocationContext({
    ...(provider ? { provider } : {}),
    ...(provider && team.model ? { requestedModel: team.model } : {}),
  });
  if (isClaudeLocalAuthProvider(runtime.activeProvider)) {
    await ensureClaudeLocalAuthReady(runtime.activeProvider);
  }

  const runToken = createTeamImageGuard({ billingUserId: input.lumosUserId ?? '', cap: IMAGES_PER_TASK_CAP });
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), input.timeoutMs ?? TASK_TIMEOUT_MS);

  let finalText = '';
  let accumulated = '';
  let dispatches = 0;
  const dispatchedTo = new Set<string>();
  let subtype = 'unknown';

  try {
    const stream = query({
      prompt: buildTaskLeaderPrompt(team.name, team.sop, members, input.task),
      options: {
        abortController,
        cwd: process.env.LUMOS_DATA_DIR || process.cwd(),
        env: runtime.env,
        settingSources: runtime.settingSources,
        ...(runtime.resolvedModel ? { model: runtime.resolvedModel } : {}),
        ...(runtime.pathToClaudeCodeExecutable
          ? { pathToClaudeCodeExecutable: runtime.pathToClaudeCodeExecutable }
          : {}),
        agents: toAgentDefinitions(members.map((m) => m.spec)),
        tools: ['Task', 'Read'],
        mcpServers: { [LUMOS_MCP_SERVER_NAME]: buildTeamImageServerConfig(runToken) },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: MAX_TURNS,
      },
    });

    for await (const message of stream) {
      const msg = message as {
        type?: string; subtype?: string; result?: unknown; num_turns?: number;
        parent_tool_use_id?: string | null;
        message?: { content?: Array<{ type?: string; text?: string; name?: string; input?: { subagent_type?: string } }> };
      };
      if (msg.type === 'assistant' && !msg.parent_tool_use_id && Array.isArray(msg.message?.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) accumulated += block.text;
          // SDK 0.3.207 派单工具在消息流里名为 Agent(配置名 Task 仍有效)——两个名都认
          if (block.type === 'tool_use' && (block.name === 'Task' || block.name === 'Agent')) {
            dispatches += 1;
            const to = block.input?.subagent_type || '成员';
            dispatchedTo.add(to);
            emit({ kind: 'dispatch', to });
          }
        }
      } else if (msg.type === 'result') {
        subtype = String(msg.subtype || 'unknown');
        if (typeof msg.result === 'string' && msg.result.trim()) finalText = msg.result;
        emit({ kind: 'done', subtype, turns: Number(msg.num_turns) || 0 });
      }
    }
  } finally {
    clearTimeout(timer);
    releaseTeamImageGuard(runToken);
  }

  // 交付文本:result 消息优先;超时/轮次耗尽时用队长已产出的文本兜底,不全损。
  const text = finalText || accumulated.trim();
  if (!text) {
    throw new Error(abortController.signal.aborted ? '团队任务超时且无任何产出' : `团队任务无产出(终态 ${subtype})`);
  }
  return { text, dispatches, dispatchedTo: [...dispatchedTo], subtype };
}
