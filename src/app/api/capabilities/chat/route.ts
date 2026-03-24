import { NextRequest } from 'next/server';
import { streamClaude } from '@/lib/claude-client';
import { getDefaultProviderId, getProvider } from '@/lib/db';
import { listPublishedCodeCapabilities, listPublishedPromptCapabilities } from '@/lib/db/capabilities';
import { initializeCapabilities } from '@/lib/capability/init';
import type { SendMessageRequest } from '@/types';

const CAPABILITY_SESSION_ID = 'capability-authoring';

function buildCapabilitySystemPrompt(): string {
  const promptCapabilities = listPublishedPromptCapabilities();
  const codeCapabilities = listPublishedCodeCapabilities();
  const existingCapabilitiesText = [
    '## 当前真实可发现的已发布能力',
    promptCapabilities.length === 0 && codeCapabilities.length === 0
      ? '- 当前没有可确认的已发布能力'
      : null,
    ...(codeCapabilities.length > 0
      ? [
          '### 代码节点',
          ...codeCapabilities.slice(0, 20).map((capability) => `- ${capability.id} | ${capability.name} | ${capability.description}`),
        ]
      : []),
    ...(promptCapabilities.length > 0
      ? [
          '### Prompt 节点',
          ...promptCapabilities.slice(0, 20).map((capability) => `- ${capability.id} | ${capability.name} | ${capability.description}`),
        ]
      : []),
  ].filter(Boolean).join('\n');

  return `你是 Lumos 的能力创建助手。帮助用户创建两种类型的 Agent 能力。

## 能力类型

### 1. 代码型能力（Code Capability）
生成确定性能力，例如文件转换、数据处理、结构化提取。

**适用场景**：
- 需要执行具体操作（文件转换、API 调用、数据处理）
- 有明确的输入输出
- 需要编程逻辑

### 2. 指令型能力（Prompt Capability）
生成给 agent 调用的 Prompt 能力。

**适用场景**：
- 提供专业知识或指导
- 定义工作流程或规范
- 设置角色和行为模式

## 对话流程

1. 先判断这是代码型能力还是 Prompt 能力
2. 如果信息不够，主动追问最关键的缺口
3. 把需求边界收敛清楚
4. 当信息足够时，用简短结构化语言总结“将要生成的能力”
5. 提醒用户可以点击页面上的生成/发布动作继续，而不是让用户手动保存文件

## 输出要求
- 你的职责是澄清和确认需求，不是直接输出最终源码全文
- 优先输出简洁摘要，而不是长代码块
- 不要要求用户复制代码、手动保存文件或重启应用
- 如果已经足够明确，请明确说明：
  - 能力类型
  - 主要输入
  - 主要输出
  - 风险点或权限需求
- 只有当某个能力确实出现在“当前真实可发现的已发布能力”列表里时，才能说“已经有这个能力”
- 如果只是相似、但列表里没有，就要明确说“目前还没有正式可发现的同类能力”

${existingCapabilitiesText}

请用友好的语气引导用户完成能力创建。`;
}

type CapabilityChatRequest = SendMessageRequest & {
  messages?: Array<{ role: string; content: string }>;
};

export async function POST(request: NextRequest) {
  try {
    await initializeCapabilities();
    const body = await request.json() as CapabilityChatRequest;
    const { content, model, provider_id, messages = [] } = body;

    const conversationHistory = messages
      .filter(
        (message): message is { role: 'user' | 'assistant'; content: string } =>
          (message.role === 'user' || message.role === 'assistant')
          && typeof message.content === 'string'
          && message.content.trim().length > 0
      )
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    const resolvedProvider = provider_id
      ? getProvider(provider_id)
      : (() => {
          const defaultProviderId = getDefaultProviderId();
          return defaultProviderId ? getProvider(defaultProviderId) : undefined;
        })();

    const stream = streamClaude({
      prompt: content,
      rawPrompt: content,
      sessionId: CAPABILITY_SESSION_ID,
      model: model || undefined,
      systemPrompt: buildCapabilitySystemPrompt(),
      provider: resolvedProvider,
      conversationHistory,
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
