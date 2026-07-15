// 出图团队的队长会话:SDK 原生 agents 子代理机制,协作方式全在提示词里,引擎只管
// 组装(成员→AgentDefinition)、护栏和结构化交差。
//
// 出图工具走独立 stdio MCP 进程 → HTTP 回调(team-image-service),不走进程内 MCP/
// canUseTool/hook——那三者都骑在 SDK↔CLI 控制协议上,复杂多子代理会话里该往返会断
// (实测 "Tool permission request failed: Stream closed")。配额与真实路径由服务端
// 注册表(team-image-guard)统一把守。

import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildClaudeSdkInvocationContext } from '@/lib/claude/sdk-runtime';
import { isClaudeLocalAuthProvider } from '@/lib/claude/provider-env';
import { ensureClaudeLocalAuthReady } from '@/lib/claude/local-auth';
import { getActiveUserId } from '@/lib/auth/user-service';
import { getProvider } from '@/lib/db/providers';
import { LUMOS_MCP_SERVER_NAME } from '@/lib/tools/lumos-mcp-server';
import { toAgentDefinitions, agentKeyOf, type TeamAgentSpec } from '@/lib/team/agent-defs';
import { buildTeamImageServerConfig } from '@/lib/team/image-server-config';
import { createTeamImageGuard, getTeamImageGuard, releaseTeamImageGuard } from '@/lib/team/image-guard';
import type { AgentTeamRow, TeamMember } from '../types';
import { TeamStreamParser, type TeamEvent } from './team-stream';

export type { TeamEvent } from './team-stream';

const IMAGE_TOOL = `mcp__${LUMOS_MCP_SERVER_NAME}__generate_image`;
const TEAM_TIMEOUT_MS = 1_800_000; // 整队一次出图的硬超时(30min);超时不再全损,有真图就部分交差
const MAX_TURNS = 40;

export interface TeamDesignOutput {
  path: string;
  member: string;
  rationale: string;
  verdict?: 'good' | 'weak';
  verdict_note?: string;
}

export interface TeamSessionResult {
  designs: TeamDesignOutput[];
  summary: string;
  imageCallsUsed: number;
}


const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    designs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'generate_image 返回的本地绝对路径' },
          member: { type: 'string', description: '出这张图的设计成员名' },
          rationale: { type: 'string', description: '一句话设计说明' },
          verdict: { type: 'string', enum: ['good', 'weak'] },
          verdict_note: { type: 'string' },
        },
        required: ['path', 'member', 'rationale'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string', description: '本次团队出图的一句话总结' },
  },
  required: ['designs', 'summary'],
  additionalProperties: false,
} as const;

// 成员 → 通用 TeamAgentSpec:工具面由显式授权决定(canGenerateImages 是唯一花钱的权限),
// description 用职能描述——这正是队长(主会话)决定派单对象的依据。
function toAgentSpecs(members: TeamMember[]): TeamAgentSpec[] {
  return members
    .filter((m) => m.enabled)
    .map((m) => ({
      key: agentKeyOf(m.name),
      description: `${m.name}:${m.duty || '团队成员'}`,
      prompt: m.prompt,
      tools: m.canGenerateImages ? [IMAGE_TOOL, 'Read'] : ['Read'],
    }));
}

// 队长提示词 = 硬护栏(引擎写死) + 团队 SOP(用户的自由领地) + 硬纪律(压轴,防被 SOP 冲掉) + 创作简报。
// 流程/分工/质量标准全部由 SOP 说了算,引擎不预设任何工种或派单顺序。
function buildLeaderPrompt(team: AgentTeamRow, members: TeamMember[], briefing: string, targetCount: number): string {
  const roster = members
    .filter((m) => m.enabled && m.prompt.trim())
    .map((m) => `- ${agentKeyOf(m.name)}${m.canGenerateImages ? '(可出图)' : ''}:${m.duty || '(无职能描述)'}`)
    .join('\n');
  const sop = (team.sop || '').replaceAll('{N}', String(targetCount)).trim();
  return [
    `你是出图团队「${team.name}」的队长,负责带队为一个 Etsy 商品产出 ${targetCount} 张原创 T恤印花设计图。`,
    '你自己不出图:一切工作用 Task 工具派给团队成员完成(subagent_type 用成员名)。',
    '',
    '团队成员(职能是你派单的依据):',
    roster,
    '',
    sop ? `===== 团队 SOP(按此工作) =====\n${sop}` : '(该团队没有写 SOP:你自行安排最合理的分工完成任务。)',
    '',
    '===== 硬纪律(优先级高于 SOP,不可违背) =====',
    '- 派单必须合批:同类工作一次派单批量完成(如一次派单产出全部设计的提示词),严禁逐张反复派单;每个成员整场至多派单 2 次。',
    `- 先出图后打磨:前期工序从简从快,拿到可用的出图提示词就立即安排出图;宁可先出满 ${targetCount} 张再评审,不可迟迟不出图。`,
    `- 出图配额有限(约 ${targetCount * 2} 次),配额被拒后立即停手,用已有产出交差。`,
    '- 交差用结构化输出:designs[].path 必须是 generate_image 真实返回的路径,一个字符都不能改;member 写产出成员名。',
    '- 某个成员失败不影响其他任务;哪怕只有一张成功也如实交差,零产出则交空 designs 并在 summary 说明原因,不编造。',
    '',
    '===== 创作简报 =====',
    briefing,
  ].join('\n');
}

export async function runTeamSession(input: {
  team: AgentTeamRow;
  briefing: string;
  targetCount: number;
  userId: string;
  onEvent?: (ev: TeamEvent) => void;
}): Promise<TeamSessionResult> {
  // 兜底回收所需的执行流事实:每次出图调用是谁发起(seq→成员)、成功产出了哪张(seq→路径)。
  const callMemberBySeq = new Map<number, string>();
  const okPathBySeq = new Map<number, string>();
  const emit = (ev: TeamEvent) => {
    if (ev.kind === 'image_call') callMemberBySeq.set(ev.seq, ev.member);
    if (ev.kind === 'image_ok') okPathBySeq.set(ev.seq, ev.path);
    try { input.onEvent?.(ev); } catch { /* 日志回调异常绝不影响出图主流程 */ }
  };
  const members = input.team.members.filter((m) => m.enabled);
  // 硬前置:至少一个成员有出图授权,否则这个团队不可能交差,提前报错比空跑一圈好。
  const producers = members.filter((m) => m.canGenerateImages && m.prompt.trim());
  if (producers.length === 0) throw new Error(`团队「${input.team.name}」没有启用且有出图权限的成员,无法出图`);

  // 两套身份别混:input.userId 是 etsy-forge 业务隔离 id(桌面恒 'local'),而 generate_image
  // 的配额计费要 Lumos 云账户 id(lumos_users)。曾把 'local' 传给计费层导致整队 5 张全被拒。
  const billingUserId = getActiveUserId();
  if (!billingUserId) {
    throw new Error('未登录 Lumos 云账户,图片生成无法计费——先在应用里登录,再跑出图团队');
  }

  const agents = toAgentDefinitions(toAgentSpecs(members));

  // 团队级会话模型:团队配了服务商/模型就用团队的,否则跟随全局默认。
  // 配的服务商被删时回退默认并留痕(不断链——团队还能跑,只是换了脑子,日志可查)。
  const teamProvider = input.team.provider_id ? getProvider(input.team.provider_id) : undefined;
  if (input.team.provider_id && !teamProvider) {
    console.warn(`[team-session] 团队「${input.team.name}」指定的服务商已不存在(${input.team.provider_id}),回退全局默认`);
  }
  const runtime = buildClaudeSdkInvocationContext({
    ...(teamProvider ? { provider: teamProvider } : {}),
    ...(teamProvider && input.team.model?.trim() ? { requestedModel: input.team.model.trim() } : {}),
  });
  // 本地登录(local_auth)服务商要先把沙箱登录态准备好,否则隔离环境无凭据 → 401(chat/mesh 同做法)。
  if (isClaudeLocalAuthProvider(runtime.activeProvider)) {
    await ensureClaudeLocalAuthReady(runtime.activeProvider);
  }

  const runToken = createTeamImageGuard({
    billingUserId,
    cap: input.targetCount * 2,
    onQuotaDenied: (used, cap) => emit({ kind: 'quota_denied', used, cap }),
  });
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), TEAM_TIMEOUT_MS);

  try {
    const stream = query({
      prompt: buildLeaderPrompt(input.team, members, input.briefing, input.targetCount),
      options: {
        abortController,
        cwd: process.env.LUMOS_DATA_DIR || process.cwd(),
        env: runtime.env,
        settingSources: runtime.settingSources,
        ...(runtime.resolvedModel ? { model: runtime.resolvedModel } : {}),
        ...(runtime.pathToClaudeCodeExecutable
          ? { pathToClaudeCodeExecutable: runtime.pathToClaudeCodeExecutable }
          : {}),
        agents,
        tools: ['Task', 'Read'],
        mcpServers: { [LUMOS_MCP_SERVER_NAME]: buildTeamImageServerConfig(runToken) },
        // 团队会话无人值守,没有权限交互 UI;权限控制流(canUseTool)在复杂会话里会断,
        // 护栏已全部落在服务端(配额+路径),这里放行。
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: MAX_TURNS,
        outputFormat: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
    });

    const parser = new TeamStreamParser(IMAGE_TOOL, emit);
    for await (const message of stream) parser.consume(message);

    const guard = getTeamImageGuard(runToken);
    return assembleResult({
      team: input.team,
      structured: parser.structured,
      producedPaths: guard?.producedPaths ?? new Set<string>(),
      imageCallsUsed: guard?.used ?? 0,
      timedOut: abortController.signal.aborted,
      callMemberBySeq,
      okPathBySeq,
    });
  } finally {
    clearTimeout(timer);
    releaseTeamImageGuard(runToken);
  }
}

// 交差组装:优先用队长的结构化申报(经真实路径校验);队长没交差或申报全数无效时,
// 从执行流回收真实产出部分交差——超时/轮次耗尽从此不再「有图也算全损」。
// 导出仅为单测(锁住兜底行为)。
export function assembleResult(input: {
  team: AgentTeamRow;
  structured: unknown;
  producedPaths: Set<string>;
  imageCallsUsed: number;
  timedOut: boolean;
  callMemberBySeq: Map<number, string>;
  okPathBySeq: Map<number, string>;
}): TeamSessionResult {
  const parsed = (input.structured ?? {}) as { designs?: TeamDesignOutput[]; summary?: string };
  const claimed = (parsed.designs ?? []).filter((d) => d && typeof d.path === 'string');
  let designs = claimed.filter((d) => input.producedPaths.has(d.path));
  if (designs.length < claimed.length) {
    // 队长交回的路径不在 generate_image 真实产出集合里(幻觉路径或复制错) → 丢弃并留痕,别静默。
    console.warn(
      `[team-session] 团队「${input.team.name}」交回 ${claimed.length} 条,其中 ${claimed.length - designs.length} 条路径不在真实产出集合(共 ${input.producedPaths.size} 条)中,已丢弃`,
    );
  }

  let summary = parsed.summary ?? '';
  if (designs.length === 0 && input.producedPaths.size > 0) {
    designs = [...input.okPathBySeq.entries()]
      .filter(([, p]) => input.producedPaths.has(p))
      .map(([seq, p]) => ({
        path: p,
        member: input.callMemberBySeq.get(seq) || '团队',
        rationale: '(引擎兜底回收:队长未正常申报此图)',
      }));
    const covered = new Set(designs.map((d) => d.path));
    for (const p of input.producedPaths) {
      if (!covered.has(p)) designs.push({ path: p, member: '团队', rationale: '(引擎兜底回收)' });
    }
    summary = summary || (input.timedOut ? '队长会话超时未收尾,引擎已回收真实产出部分交差。' : '队长未正常交差,引擎已回收真实产出部分交差。');
  }

  if (!input.structured && designs.length === 0) {
    throw new Error(input.timedOut ? '团队出图超时(30min)且无任何真实产出' : '团队没有交回结构化产出,也没有任何真实出图');
  }
  return { designs, summary, imageCallsUsed: input.imageCallsUsed };
}
