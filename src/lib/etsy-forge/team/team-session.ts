// 出图团队的队长会话:SDK 原生 agents 子代理机制,协作方式全在提示词里,引擎只管
// 组装(成员→AgentDefinition)、护栏(出图配额 canUseTool + 真实产出路径追踪)和结构化交差。

import { query, type CanUseTool, type Options } from '@anthropic-ai/claude-agent-sdk';
import { buildClaudeSdkInvocationContext } from '@/lib/claude/sdk-runtime';
import { isClaudeLocalAuthProvider } from '@/lib/claude/provider-env';
import { ensureClaudeLocalAuthReady } from '@/lib/claude/local-auth';
import { getActiveUserId } from '@/lib/auth/user-service';
import { getProvider } from '@/lib/db/providers';
import { createLumosMcpServer, LUMOS_MCP_SERVER_NAME } from '@/lib/tools/lumos-mcp-server';
import type { AgentTeamRow, TeamMember } from '../types';

const IMAGE_TOOL = `mcp__${LUMOS_MCP_SERVER_NAME}__generate_image`;
const TEAM_TIMEOUT_MS = 1_200_000; // 整队一次出图的硬超时(20min):多成员串并混合,给足但不放飞
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

// 成员 → SDK AgentDefinition。工具面由显式授权决定(canGenerateImages 是唯一花钱的权限),
// description 用职能描述——这正是队长(主会话)决定派单对象的依据。
function toAgentDefinitions(members: TeamMember[]): NonNullable<Options['agents']> {
  const agents: NonNullable<Options['agents']> = {};
  for (const m of members) {
    if (!m.enabled || !m.prompt.trim()) continue;
    agents[agentKey(m)] = {
      description: `${m.name}:${m.duty || '团队成员'}`,
      prompt: m.prompt,
      tools: m.canGenerateImages ? [IMAGE_TOOL, 'Read'] : ['Read'],
      model: 'inherit',
    };
  }
  return agents;
}

// agents 字典的 key 就是队长派单用的 subagent_type;用成员名(去空格)保持提示词里可读。
function agentKey(m: TeamMember): string {
  return m.name.replace(/\s+/g, '-');
}

// 队长提示词 = 硬护栏(引擎写死) + 团队 SOP(用户的自由领地) + 硬纪律(压轴,防被 SOP 冲掉) + 创作简报。
// 流程/分工/质量标准全部由 SOP 说了算,引擎不预设任何工种或派单顺序。
function buildLeaderPrompt(team: AgentTeamRow, members: TeamMember[], briefing: string, targetCount: number): string {
  const roster = members
    .filter((m) => m.enabled && m.prompt.trim())
    .map((m) => `- ${agentKey(m)}${m.canGenerateImages ? '(可出图)' : ''}:${m.duty || '(无职能描述)'}`)
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
}): Promise<TeamSessionResult> {
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

  const agents = toAgentDefinitions(members);

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
  const imageCap = input.targetCount * 2;
  let imageCalls = 0;
  const producedPaths = new Set<string>();

  // 出图配额:对 generate_image 计数(含 count 参数),超额拒绝并告知队长收口。
  const canUseTool: CanUseTool = async (toolName, toolInput) => {
    if (toolName === IMAGE_TOOL) {
      const n = Math.max(1, Math.floor(Number((toolInput as { count?: number }).count ?? 1)));
      if (imageCalls + n > imageCap) {
        return { behavior: 'deny', message: `出图配额已用完(上限 ${imageCap} 张),用已有产出交差` };
      }
      imageCalls += n;
    }
    return { behavior: 'allow', updatedInput: toolInput };
  };

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), TEAM_TIMEOUT_MS);

  let structured: unknown;
  try {
    const stream = query({
      prompt: buildLeaderPrompt(input.team, members, input.briefing, input.targetCount),
      options: {
        abortController,
        cwd: process.env.LUMOS_DATA_DIR || process.cwd(),
        // generate_image 单次 50-100s+(网络差时更久),SDK 默认 MCP 工具超时会把它掐成
        // "Stream closed"(实测)。团队场景长工具调用是常态,放宽到 15min(仍受 20min 会话硬超时兜底)。
        env: { ...runtime.env, MCP_TOOL_TIMEOUT: '900000' },
        settingSources: runtime.settingSources,
        ...(runtime.resolvedModel ? { model: runtime.resolvedModel } : {}),
        ...(runtime.pathToClaudeCodeExecutable
          ? { pathToClaudeCodeExecutable: runtime.pathToClaudeCodeExecutable }
          : {}),
        agents,
        tools: ['Task', 'Read'],
        mcpServers: { [LUMOS_MCP_SERVER_NAME]: createLumosMcpServer(undefined, billingUserId) },
        permissionMode: 'default',
        canUseTool,
        maxTurns: MAX_TURNS,
        outputFormat: { type: 'json_schema', schema: OUTPUT_SCHEMA },
        hooks: {
          // 记录 generate_image 的真实产出路径:最终交差的 path 必须在这个集合里(防幻觉路径)。
          PostToolUse: [{
            hooks: [async (hookInput) => {
              collectProducedPaths(hookInput, producedPaths);
              return {};
            }],
          }],
        },
      },
    });

    for await (const message of stream) {
      const msg = message as { type?: string; structured_output?: unknown };
      if (msg.type === 'result' && msg.structured_output) structured = msg.structured_output;
    }
  } finally {
    clearTimeout(timer);
  }

  if (!structured) {
    throw new Error(abortController.signal.aborted ? `团队出图超时(${TEAM_TIMEOUT_MS / 60000}min)` : '团队没有交回结构化产出');
  }

  const parsed = structured as { designs?: TeamDesignOutput[]; summary?: string };
  const claimed = (parsed.designs ?? []).filter((d) => d && typeof d.path === 'string');
  const designs = claimed.filter((d) => producedPaths.has(d.path));
  if (designs.length < claimed.length) {
    // 队长交回的路径不在 generate_image 真实产出集合里(幻觉路径或复制错) → 丢弃并留痕,别静默。
    console.warn(
      `[team-session] 团队「${input.team.name}」交回 ${claimed.length} 条,其中 ${claimed.length - designs.length} 条路径不在真实产出集合(共 ${producedPaths.size} 条)中,已丢弃`,
    );
  }
  return { designs, summary: parsed.summary ?? '', imageCallsUsed: imageCalls };
}

// 导出仅为单测:PostToolUse 的 tool_response 形状(content 数组无包裹)是实测出来的坑,要有回归盯着。
export function collectProducedPaths(hookInput: unknown, sink: Set<string>): void {
  const h = hookInput as { tool_name?: string; tool_response?: unknown };
  if (h.tool_name !== IMAGE_TOOL) return;
  // PostToolUse 的 tool_response 就是 MCP content 块数组本身(实测 SDK 0.3.207),不带 {content} 包裹。
  const content = h.tool_response;
  if (!Array.isArray(content)) return;
  for (const block of content as Array<{ type?: string; text?: string }>) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    try {
      const payload = JSON.parse(block.text) as { images?: Array<{ path?: string }> };
      for (const img of payload.images ?? []) {
        if (typeof img?.path === 'string' && img.path) sink.add(img.path);
      }
    } catch {
      // 非 JSON 文本(如错误消息)——跳过
    }
  }
}
