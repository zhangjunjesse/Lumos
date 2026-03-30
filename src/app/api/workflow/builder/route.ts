import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { getDefaultProvider } from '@/lib/db';
import { generateTextFromProvider } from '@/lib/text-generator';
import { generateWorkflow } from '@/lib/workflow/compiler';

const requestSchema = z.object({
  description: z.string().trim().min(1).max(2000),
  workingDirectory: z.string().optional(),
  providerId: z.string().optional(),
  model: z.string().optional(),
});

const SYSTEM_PROMPT = `You are a workflow DSL generator for Lumos.
Given a natural language description, output a valid Workflow DSL v1 JSON object.

## DSL Structure
{
  "version": "v1",
  "name": "<workflow name>",
  "steps": [<step objects>]
}

## Step Types

### Agent step
{
  "id": "<unique-id>",
  "type": "agent",
  "dependsOn": ["<step-id>"],
  "input": {
    "prompt": "<what this agent should do>",
    "role": "worker" | "researcher" | "coder" | "integration",
    "outputMode": "plain-text" | "structured"
  }
}

### Browser step
{
  "id": "<unique-id>",
  "type": "browser",
  "dependsOn": ["<step-id>"],
  "input": {
    "action": "navigate" | "click" | "fill" | "screenshot",
    "url": "<url for navigate>",
    "selector": "<css selector for click/fill>",
    "value": "<value for fill>",
    "pageId": "<reuse existing page>",
    "createPage": true
  }
}

### Notification step
{
  "id": "<unique-id>",
  "type": "notification",
  "dependsOn": ["<step-id>"],
  "input": {
    "message": "<notification message>",
    "level": "info" | "warning" | "error"
  }
}

## Conditional (if/else)
Use "when" to make a step conditional:
{
  "when": { "op": "exists", "ref": "steps.someStep.output" }
}
Or: { "op": "eq", "left": "steps.someStep.output.status", "right": "success" }

## Parallel steps
Steps with no shared dependencies run in parallel automatically.

## Rules
- Step IDs must be kebab-case, unique
- "dependsOn" references step IDs that must complete first
- Agent prompt can reference upstream output: "steps.stepId.output.summary"
- Return ONLY valid JSON, no markdown, no explanation`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = requestSchema.parse(body);

    const provider = getDefaultProvider();
    if (!provider) {
      return NextResponse.json(
        { error: '未配置 AI 服务商，请先在设置中添加' },
        { status: 400 },
      );
    }

    const providerId = input.providerId || provider.id;
    const model = input.model || '';

    const raw = await generateTextFromProvider({
      providerId,
      model,
      system: SYSTEM_PROMPT,
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

    // Validate by compiling
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compiled = generateWorkflow({ spec: dsl as any });
    const validationErrors = compiled.validation.valid ? [] : compiled.validation.errors;

    return NextResponse.json({
      workflowDsl: dsl,
      validation: { valid: compiled.validation.valid, errors: validationErrors },
      rawResponse: raw,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate workflow';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
