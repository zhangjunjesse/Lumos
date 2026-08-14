// 一次性团队任务执行(平台通用,工作流团队步骤用):队长按 SOP 派单成员完成任务,
import { resolveImageProviderId } from '@/lib/image/image-provider-resolver';
import { sanitizeImageProviderId } from '@/lib/image/image-provider-hint';
// 返回最终交差文本 + 执行事件。与聊天团队会话同一套成员解析/工具授权/出图护栏,
// 差别:无会话状态(不 resume)、任务一次给全、交差即结束;MCP 面只有出图(聊天团队
// 继承会话已起好的 office/浏览器/知识库等),内置工具(Read/Write/Edit/Bash)则一致全开。
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
import { createTeamTraceCollector, type TeamTaskTrace } from './task-trace';
import { buildRosterLines, resolveReadyMembers, TEAM_HARD_RULES, type ReadyMember } from './resolve-members';

const TASK_TIMEOUT_MS = 1_800_000; // 30min:调用方没传超时时的兜底(工作流 team 步骤会传节点配置)
const TURNS_PER_MINUTE = 3;
const MIN_TURNS = 40;
const MAX_TURNS_CAP = 400;
// 只用来兜住 agent 死循环刷图,不是产品意义上的配额;正常任务不该撞到。
const IMAGES_PER_TASK_CAP = 999;

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
  /** 执行痕迹(队长派单 + 成员明细):给工作流详情页渲染「执行过程」。 */
  trace: TeamTaskTrace;
  /** 是否被超时掐断。超时但有产出时也要如实上报,否则用户看到「成功但产出不全」无从判断。 */
  timedOut: boolean;
  /** 本次实际生效的超时上限(毫秒),用于错误信息与执行记录。 */
  timeoutMs: number;
  /** 轮次耗尽被 SDK 停止(同样会导致产出不全,必须上报而不是静默兜底)。 */
  turnsExhausted: boolean;
}

function formatMinutes(ms: number): string {
  const min = ms / 60_000;
  return Number.isInteger(min) ? `${min} 分钟` : `${min.toFixed(1)} 分钟`;
}

/**
 * 轮次上限随超时缩放。真正的成本闸门是超时(硬时间墙),轮次只防短时间内的失控循环。
 * 曾硬编码 40,与「节点上可配 100 分钟超时」明显不匹配:超时放开后轮次先撞墙,
 * SDK 停在半路,而这里用已有文本兜底返回 —— 步骤显示成功、产出不全,用户无从判断。
 */
function resolveMaxTurns(timeoutMs: number): number {
  const byTime = Math.round((timeoutMs / 60_000) * TURNS_PER_MINUTE);
  return Math.min(MAX_TURNS_CAP, Math.max(MIN_TURNS, byTime));
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
  /**
   * 原始 SDK 消息流回调,来一条给一条。工作流 team 步骤用它把 trace 实时落盘,
   * 详情页运行中才有东西可看 —— 否则那张卡永远停在「等待运行日志写入」。
   * 与 onEvent 分开:onEvent 是语义事件(派单/完成),这个是原始流。
   */
  onSdkMessage?: (message: unknown) => void;
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

  // 团队级图片服务商:团队默认 → 全局默认(就近原则)。成员级细分见 T3.2 第二批。
  const teamImageProviderId = resolveImageProviderId({
    hasTeam: true,
    teamDefaultImageProviderId: sanitizeImageProviderId(team.defaultImageProviderId, '团队默认'),
  });
  const runToken = createTeamImageGuard({
    billingUserId: input.lumosUserId ?? '',
    cap: IMAGES_PER_TASK_CAP,
    imageProviderId: teamImageProviderId,
    teamId: team.id,
  });
  const abortController = new AbortController();
  // 调用方(工作流 team 步骤)必须把节点上配置的超时传进来;缺省值只是兜底
  const effectiveTimeoutMs = input.timeoutMs ?? TASK_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abortController.abort(); }, effectiveTimeoutMs);

  let finalText = '';
  let accumulated = '';
  let dispatches = 0;
  const dispatchedTo = new Set<string>();
  let subtype = 'unknown';
  // 收全部消息(含成员的):过去只认队长消息,导致详情页里中间工序是黑箱
  const traceCollector = createTeamTraceCollector();

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
        // 不设顶层 tools 白名单:那是 SDK 的全局工具集,会连成员一起锁死。
        // 曾写成 ['Task','Read'],于是成员连 Bash/Write 都没有,SOP 里"跑 python 写台账"
        // 这类步骤必然失败(#46/#47),而成员的 disallowedTools 档位在白名单面前形同虚设。
        // 与聊天团队对齐:工具面全开,队长靠 TEAM_HARD_RULES 约束不自己动手,
        // 成员按各自权限档位用 disallowedTools 收紧。
        mcpServers: { [LUMOS_MCP_SERVER_NAME]: buildTeamImageServerConfig(runToken) },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: resolveMaxTurns(effectiveTimeoutMs),
      },
    });

    for await (const message of stream) {
      const msg = message as {
        type?: string; subtype?: string; result?: unknown; num_turns?: number;
        parent_tool_use_id?: string | null;
        message?: { content?: Array<{ type?: string; text?: string; name?: string; input?: { subagent_type?: string } }> };
      };
      traceCollector.onMessage(message);
      // 实时落盘要即时,不能等任务结束(团队任务动辄几十分钟)
      try { input.onSdkMessage?.(message); } catch { /* 落盘失败不影响执行 */ }
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
    // 错误信息必须自带诊断:超时上限多少、派了几次单、去哪改。
    // 只说「超时」会让人反复调节点上的超时设置却毫无效果(那个值曾经根本没被读)。
    const roster = dispatchedTo.size > 0 ? `,派给了 ${[...dispatchedTo].join('、')}` : '';
    const progress = `已派单 ${dispatches} 次${roster}`;
    throw new Error(
      timedOut
        ? `团队任务超时(上限 ${formatMinutes(effectiveTimeoutMs)})且无任何产出。${progress}。`
          + '若确实需要更长时间,在工作流编辑器里选中该团队节点,改右侧的「超时」。'
        : `团队任务无产出(终态 ${subtype})。${progress}。`,
    );
  }
  return {
    text,
    dispatches,
    dispatchedTo: [...dispatchedTo],
    subtype: timedOut ? 'timeout' : subtype,
    trace: traceCollector.build(),
    timedOut,
    timeoutMs: effectiveTimeoutMs,
    turnsExhausted: subtype.includes('max_turns'),
  };
}
