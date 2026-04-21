import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { getDefaultProvider, getProvider } from '@/lib/db';
import { getSetting } from '@/lib/db/sessions';
import { generateTextFromProvider } from '@/lib/text-generator';
import { generateWorkflowFromDsl } from '@/lib/workflow/compiler';
import { validateAnyWorkflowDsl } from '@/lib/workflow/dsl';
import type { AnyWorkflowDSL } from '@/lib/workflow/types';
import { listAgentPresets, type AgentPresetDirectoryItem } from '@/lib/db/agent-presets';

const requestSchema = z.object({
  description: z.string().trim().min(1).max(2000),
  workingDirectory: z.string().optional(),
  providerId: z.string().optional(),
  model: z.string().optional(),
});

const DSL_BASE_PROMPT = `你是 Lumos 工作流 DSL 生成器。
根据用户的自然语言描述和可用 Agent 列表，输出合法的 Workflow DSL v3 JSON 对象。

## DSL 结构 (v3 — 边优先)
{
  "version": "v3",
  "name": "<工作流名称>",
  "nodes": [<节点对象>],
  "edges": [<边对象>]
}

v3 与旧版本的关键区别：
- 不再有 steps[] + dependsOn；改用 nodes[] + edges[]
- 结构（顺序、分支、循环）完全由 edges 描述
- 每条边形如: { "from": "<源>", "to": "<目标>", "kind": "next" | "then" | "else" | "body" }
- 入口节点唯一（只有它没有非 on-error 入边）
- 分支必须在同一"汇合点"重新并合（SESE）

## 节点类型

### 1. agent — 必须从下方【可用 Agent】列表中选择
{
  "id": "<唯一节点 ID>",
  "type": "agent",
  "input": {
    "preset": "<来自可用 Agent 列表的 agent id>",
    "prompt": "<该节点自身的任务描述，不包含上游数据>",
    "context": { "<上游节点ID>": "steps.<上游节点ID>.output.summary" },
    "outputMode": "plain-text" | "structured",
    "expectedOutput": "<可选的验收说明，见下>"
  },
  "outputContract": <可选: JSON Schema，声明 agent 输出结构>
}

**expectedOutput（验收说明，可选）**
用自然语言写"怎样算这一步做完了"，判分老师会拿这段话去对照 agent 的实际输出 + 工具调用事实打分。
- 留空 / 不写这个字段 → 系统跳过判分，只看 SDK 执行成功与否
- 写了 → 判分老师只读这段文字，**不会**看 prompt
- 有硬性工具调用需求（出图/写文件/发消息），明确写出来
- 纯文本任务写明"不需要调用工具"；无明显验收边界就留空

### 2. if-else — 条件分支
{ "id": "<节点ID>", "type": "if-else", "input": { "condition": <ConditionExpr> } }
出边：必须恰好 1 条 then + 1 条 else，且 then/else 分支的所有路径必须汇合到同一节点（merge）。
merge 节点是 if-else 之后的下一个"公共后继"。

condition 支持:
- { "op": "exists", "ref": "steps.xxx.output.yyy" }
- { "op": "eq"|"neq"|"gt"|"lt", "left": "<引用>", "right": <值> }
- { "op": "and"|"or", "conditions": [<子条件>] }
- { "op": "not", "condition": <子条件> }

检测步骤执行成功: { "op": "eq", "left": "steps.<ID>.success", "right": true }

### 3. for-each — 遍历集合
{ "id": "<ID>", "type": "for-each", "input": {
  "collection": "steps.<ID>.output.<数组字段>",
  "itemVar": "item",
  "maxIterations": 50
}}
出边：1 条 body (指向 body 起点) + 1 条 next (指向循环退出后继)。
body 内用 "{{ itemVar }}" 引用当前元素，不要在 body 外引用。
**不同的 for-each 节点 itemVar 名必须全局唯一**（V3 校验器按名字判定作用域）。

### 4. while / do-while — 条件循环
{ "id": "<ID>", "type": "while", "input": {
  "condition": <ConditionExpr>,
  "maxIterations": 20,
  "mode": "while" | "do-while",
  "state": { "initial": {...}, "update": {...} }
}}
出边：1 条 body + 1 条 next。
- mode: while 先判断后执行；do-while 先执行再判断
- **condition 如果依赖 body 输出或 state，必须用 do-while**
- condition 的引用必须是该循环的**拓扑前驱**或 state 字段；不能直接引用 body 内节点（V3 拒绝）
- 跨迭代数据用 state: initial (首轮值) + update (每轮末更新规则)

### 5. parallel + join — 并发分支
parallel 节点出 N≥2 条 next 边到各分支起点（可带 branchIndex 排序），
所有分支最终汇到同一个 join 节点，join 再接后续。
{ "id": "fan", "type": "parallel", "input": { "onBranchFail": "wait-all" } }
{ "id": "sync", "type": "join", "input": {} }

### 6. wait / notification / capability / approval
wait: { "type": "wait", "input": { "durationMs": 1000 } }
notification / capability: 输入由 preset 提供
approval: 人工审批门（需要 approvers 配置）

## 边 (edges) 示例
\`\`\`json
// 线性: a → b → c
{ "from": "a", "to": "b", "kind": "next" }
{ "from": "b", "to": "c", "kind": "next" }

// if-else (head → then/else → merge)
{ "from": "gate", "to": "yes", "kind": "then" }
{ "from": "gate", "to": "no",  "kind": "else" }
{ "from": "yes",  "to": "merge", "kind": "next" }
{ "from": "no",   "to": "merge", "kind": "next" }

// for-each
{ "from": "loop", "to": "step-in-body", "kind": "body" }
{ "from": "loop", "to": "after-loop",   "kind": "next" }
// body 内最后一个节点可不出边（V3 runtime 自动迭代）

// parallel
{ "from": "fan", "to": "branch-1", "kind": "next", "branchIndex": 0 }
{ "from": "fan", "to": "branch-2", "kind": "next", "branchIndex": 1 }
{ "from": "branch-1", "to": "sync", "kind": "next" }
{ "from": "branch-2", "to": "sync", "kind": "next" }
\`\`\`

## 对外 output 约定
- **while / do-while** → { state, iterations, errors } — 外部读 \`steps.<id>.output.state.<字段>\`
- **for-each** → { results, count } — 外部读 \`steps.<id>.output.results[N].output.<字段>\`
- **if-else** → { branch: "then"|"else" } — 没有数据通道，要消费分支内结果就把消费节点放进同一分支
- **agent** → 字段 summary（主要文本）、outcome ("done"|"error"|"failed")；不要引用 content/text/result

## 引用规则
- \`{{ steps.X.output.yyy }}\` 或 \`steps.X.output.yyy\` — X 必须是引用节点的**拓扑前驱**（即 X 能通过边路径到达当前节点）
- \`{{ itemVar }}\` — 仅在对应 for-each 的 body 内使用
- \`state.xxx\` — 仅在对应 while 的 body 或 condition 中使用

## 规则
- 节点 ID 用 kebab-case，首字母必须为字母
- 入口节点唯一（没有非 on-error 入边）
- 控制流节点（if-else / for-each / while / parallel）**必须有出边**，不能做尾节点
- agent 节点只能用【可用 Agent】里的 preset id
- 优先线性结构，只有用户明确描述分支/循环时才使用控制流
- Agent 不足时返回: { "insufficient_agents": true, "suggestion": "<说明>" }
- 只输出合法 JSON，不要 markdown 标记或解释文字`;

function buildAgentListBlock(agents: AgentPresetDirectoryItem[]): string {
  if (agents.length === 0) {
    return '\n## AVAILABLE AGENTS\n(none — you must respond with insufficient_agents=true)';
  }
  const lines = agents.map(a =>
    `- id: "${a.id}"  name: "${a.name}"  description: "${a.description || ''}"`,
  );
  return `\n## AVAILABLE AGENTS\n${lines.join('\n')}`;
}

function validateAgentPresets(dsl: unknown, validIds: Set<string>): string[] {
  if (!dsl || typeof dsl !== 'object') return [];
  const container = dsl as { steps?: unknown; nodes?: unknown };
  const items = Array.isArray(container.nodes)
    ? container.nodes
    : Array.isArray(container.steps)
      ? container.steps
      : null;
  if (!items) return [];

  const errors: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const s = item as { id?: unknown; type?: unknown; input?: unknown };
    if (s.type !== 'agent') continue;
    const input = s.input as Record<string, unknown> | undefined;
    if (!input) continue;
    const preset = input.preset;
    if (typeof preset !== 'string' || !preset.trim()) {
      errors.push(`Agent node "${String(s.id)}" is missing required "preset" field`);
    } else if (!validIds.has(preset)) {
      errors.push(`Agent node "${String(s.id)}" references unknown preset "${preset}" — only use IDs from the available agents list`);
    }
  }
  return errors;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = requestSchema.parse(body);

    const configuredProviderId = getSetting('workflow_builder_provider_id') || '';
    const configuredModel = getSetting('workflow_builder_model') || '';
    const effectiveProviderId = input.providerId || configuredProviderId;
    const provider = effectiveProviderId ? getProvider(effectiveProviderId) : getDefaultProvider();

    if (!provider) {
      return NextResponse.json(
        { error: '未配置 AI 服务商，请先在设置中添加' },
        { status: 400 },
      );
    }

    const providerId = provider.id;
    const model = input.model || configuredModel || (() => {
      const catalog = JSON.parse(provider.model_catalog || '[]') as Array<{ value?: string }>;
      return catalog[0]?.value || '';
    })();

    if (!model) {
      return NextResponse.json(
        { error: '未找到可用模型，请在服务商中配置模型后重试' },
        { status: 400 },
      );
    }

    const agents = listAgentPresets();
    const validIds = new Set(agents.map(a => a.id));
    const configuredPrompt = getSetting('workflow_builder_system_prompt') || '';
    const basePrompt = configuredPrompt || DSL_BASE_PROMPT;
    const systemPrompt = basePrompt + buildAgentListBlock(agents);

    const raw = await generateTextFromProvider({
      providerId,
      model,
      system: systemPrompt,
      prompt: `Generate a Workflow DSL for the following task:\n\n${input.description}${input.workingDirectory ? `\n\nWorking directory: ${input.workingDirectory}` : ''}`,
      maxTokens: 2000,
    });

    // Extract JSON from the response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: 'LLM 未返回有效 JSON，请重试或手动编辑 DSL' },
        { status: 422 },
      );
    }

    let dsl: unknown;
    try {
      dsl = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json(
        { error: 'LLM 返回的 JSON 无法解析，请重试' },
        { status: 422 },
      );
    }

    // Check if LLM signalled insufficient agents
    if (dsl && typeof dsl === 'object' && 'insufficient_agents' in dsl) {
      const d = dsl as { insufficient_agents: boolean; suggestion?: string };
      if (d.insufficient_agents) {
        const suggestion = d.suggestion || '请创建更多 Agent 后重试';
        return NextResponse.json(
          { error: `可用 Agent 不足，无法完成该工作流。${suggestion}` },
          { status: 422 },
        );
      }
    }

    // Validate preset IDs
    const presetErrors = validateAgentPresets(dsl, validIds);
    if (presetErrors.length > 0) {
      return NextResponse.json(
        { error: `工作流引用了不存在的 Agent：${presetErrors[0]}` },
        { status: 422 },
      );
    }

    // Validate DSL structure first
    const structureValidation = validateAnyWorkflowDsl(dsl as AnyWorkflowDSL);
    if (!structureValidation.valid) {
      return NextResponse.json({
        workflowDsl: dsl,
        validation: structureValidation,
        rawResponse: raw,
      });
    }

    // Try compilation (v2 control-flow compilation not yet supported — validation still passes)
    const compiled = generateWorkflowFromDsl(dsl as AnyWorkflowDSL);

    return NextResponse.json({
      workflowDsl: dsl,
      validation: compiled.validation,
      rawResponse: raw,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate workflow';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
