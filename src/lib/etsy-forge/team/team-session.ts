// 出图团队的队长会话:SDK 原生 agents 子代理机制,协作方式全在提示词里,引擎只管
// 组装(成员→AgentDefinition)、护栏(出图配额 canUseTool + 真实产出路径追踪)和结构化交差。

import { query, type CanUseTool, type Options } from '@anthropic-ai/claude-agent-sdk';
import { buildClaudeSdkInvocationContext } from '@/lib/claude/sdk-runtime';
import { isClaudeLocalAuthProvider } from '@/lib/claude/provider-env';
import { ensureClaudeLocalAuthReady } from '@/lib/claude/local-auth';
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

// 成员 → SDK AgentDefinition。职能决定工具面:设计=出图+看图;策划/审核=只看图。
function toAgentDefinitions(members: TeamMember[]): NonNullable<Options['agents']> {
  const agents: NonNullable<Options['agents']> = {};
  for (const m of members) {
    if (!m.enabled || !m.prompt.trim()) continue;
    agents[agentKey(m)] = {
      description: `${m.name}(${m.role}):团队成员,按其人设工作。派活时 subagent_type 用这个名字。`,
      prompt: m.prompt,
      tools: m.role === 'designer' ? [IMAGE_TOOL, 'Read'] : ['Read'],
      model: 'inherit',
    };
  }
  return agents;
}

// agents 字典的 key 就是队长派单用的 subagent_type;用成员名(去空格)保持提示词里可读。
function agentKey(m: TeamMember): string {
  return m.name.replace(/\s+/g, '-');
}

function buildLeaderPrompt(team: AgentTeamRow, memberKeys: { key: string; role: string }[], briefing: string, targetCount: number): string {
  const roster = memberKeys.map((m) => `- ${m.key}(${m.role})`).join('\n');
  const hasStrategist = memberKeys.some((m) => m.role === 'strategist');
  const hasReviewer = memberKeys.some((m) => m.role === 'reviewer');
  return [
    `你是出图团队「${team.name}」的队长,负责带队为一个 Etsy 商品产出 ${targetCount} 张原创 T恤印花设计图。`,
    '你自己不出图:一切创作、出图、质检都用 Task 工具派给团队成员完成。',
    '',
    '团队成员(Task 的 subagent_type 用成员名):',
    roster,
    '',
    '工作流程:',
    hasStrategist
      ? `1. 先派策划成员:把创作简报交给它,拿到 ${targetCount} 条创作指令。`
      : `1. 没有策划成员:你自己根据简报拟 ${targetCount} 条一句话创作指令(一半贴近参考、一半发散;有 IP 风险则全部发散)。`,
    `2. 把创作指令逐条派给设计成员(多个设计成员就分摊,可以并行派多个 Task);每条任务要附上完整指令${targetCount > 1 ? '和参考印花路径(指令要求贴近时才让它用)' : ''}。`,
    hasReviewer
      ? '3. 收齐设计产出后,把全部图片路径一次性派给审核成员评级(good/weak+原因)。'
      : '3. 没有审核成员:不评级,verdict 留空。',
    '4. 交差:按结构化输出格式汇总每张图的路径、出图成员、设计说明和评级。path 必须是 generate_image 真实返回的路径,一个字符都不能改。',
    '',
    '纪律:',
    `- 出图配额有限(约 ${targetCount * 2} 次),失败的指令最多重派一次,配额被拒后立即用已有产出交差。`,
    '- 某个成员失败不影响其他任务;最终哪怕只有一张成功也要如实交差,零产出则在 summary 里说明原因。',
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
  const designers = members.filter((m) => m.role === 'designer' && m.prompt.trim());
  if (designers.length === 0) throw new Error(`团队「${input.team.name}」没有启用的设计成员,无法出图`);

  const agents = toAgentDefinitions(members);
  const memberKeys = members
    .filter((m) => m.prompt.trim())
    .map((m) => ({ key: agentKey(m), role: m.role }));

  const runtime = buildClaudeSdkInvocationContext();
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
      prompt: buildLeaderPrompt(input.team, memberKeys, input.briefing, input.targetCount),
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
        mcpServers: { [LUMOS_MCP_SERVER_NAME]: createLumosMcpServer(undefined, input.userId) },
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

function collectProducedPaths(hookInput: unknown, sink: Set<string>): void {
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
