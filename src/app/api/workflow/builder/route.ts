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
根据用户的自然语言描述和可用 Agent 列表，输出合法的 Workflow DSL v2 JSON 对象。

## DSL 结构
{
  "version": "v2",
  "name": "<工作流名称>",
  "steps": [<步骤对象>]
}

## 步骤类型

### 1. Agent 步骤 — 必须从下方【可用 Agent】列表中选择
{
  "id": "<唯一步骤ID>",
  "type": "agent",
  "dependsOn": ["<依赖的步骤ID>"],
  "input": {
    "preset": "<来自可用 Agent 列表的 agent id>",
    "prompt": "<该步骤自身的任务描述，不包含上游数据>",
    "context": { "<上游步骤ID>": "steps.<上游步骤ID>.output.summary" },
    "outputMode": "plain-text" | "structured"
  }
}

### 2. 条件分支 if-else — 根据上游步骤输出决定走哪条分支
{
  "id": "<唯一步骤ID>",
  "type": "if-else",
  "dependsOn": ["<依赖的步骤ID>"],
  "input": {
    "condition": { "op": "gt", "left": "steps.<步骤ID>.output.<字段>", "right": <值> },
    "then": ["<条件为真时执行的步骤ID列表>"],
    "else": ["<条件为假时执行的步骤ID列表，可选>"]
  }
}
condition 支持的操作：
- { "op": "exists", "ref": "steps.xxx.output.yyy" }
- { "op": "eq"|"neq"|"gt"|"lt", "left": "<引用>", "right": <值> }
- { "op": "and"|"or", "conditions": [<子条件>] }
- { "op": "not", "condition": <子条件> }

检测步骤执行是否成功（常用于 if-else）：
- 推荐：{ "op": "eq", "left": "steps.<ID>.output.outcome", "right": "done" }
- 简写：{ "op": "eq", "left": "steps.<ID>.success", "right": true }
⚠️ 禁止使用 steps.<ID>.output.success（该字段不存在），应使用 steps.<ID>.success 或 steps.<ID>.output.outcome

### 3. 遍历循环 for-each — 遍历集合中的每一项
{
  "id": "<唯一步骤ID>",
  "type": "for-each",
  "dependsOn": ["<产生集合的步骤ID>"],
  "input": {
    "collection": "steps.<步骤ID>.output.<数组字段>",
    "itemVar": "item",
    "body": ["<循环体内执行的步骤ID列表>"],
    "maxIterations": 50
  }
}

### 4. 条件循环 while — 条件成立时重复执行
{
  "id": "<唯一步骤ID>",
  "type": "while",
  "dependsOn": ["<依赖的步骤ID>"],
  "input": {
    "condition": { "op": "exists", "ref": "steps.<步骤ID>.output.hasMore" },
    "body": ["<循环体内执行的步骤ID列表>"],
    "maxIterations": 20
  }
}

## 规则
- 步骤 ID 使用 kebab-case，全局唯一
- dependsOn 引用必须在前面已定义的步骤 ID，无公共依赖的步骤自动并行
- **有 dependsOn 的 agent 步骤，必须在 input 中加 context 字段**，把所有上游步骤的输出引用进来
- prompt 只描述本步骤自身的任务，不要把上游数据直接写进 prompt
- 上游数据通过 context 传递，Agent 运行时会自动获得上游的完整输出
- agent 步骤的输出字段只有：summary（主要文本输出）、outcome（"done"|"error"|"failed"）——不要引用 content、text、result 等不存在的字段
- 每个步骤只负责自己的工作边界
- agent 步骤只能使用【可用 Agent】列表中的 preset id，不得自造 id
- if-else/for-each/while 的 then/else/body 引用的步骤 ID 也必须定义在 steps 数组中
- 优先用简单的线性流程；只有当用户描述明确包含条件判断、循环遍历等逻辑时才使用控制流步骤
- 如果现有 Agent 不足以完成任务，返回如下 JSON：
  { "insufficient_agents": true, "suggestion": "<说明需要补充哪类 Agent>" }
- 只输出合法 JSON，不添加 markdown 格式和任何解释文字`;

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
  if (!dsl || typeof dsl !== 'object' || !('steps' in dsl)) return [];
  const steps = (dsl as { steps: unknown }).steps;
  if (!Array.isArray(steps)) return [];

  const errors: string[] = [];
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const s = step as { id?: unknown; type?: unknown; input?: unknown };
    if (s.type !== 'agent') continue;
    const input = s.input as Record<string, unknown> | undefined;
    if (!input) continue;
    const preset = input.preset;
    if (typeof preset !== 'string' || !preset.trim()) {
      errors.push(`Agent step "${String(s.id)}" is missing required "preset" field`);
    } else if (!validIds.has(preset)) {
      errors.push(`Agent step "${String(s.id)}" references unknown preset "${preset}" — only use IDs from the available agents list`);
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
