import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { getDefaultProvider, getProvider } from '@/lib/db/providers';
import { getSetting } from '@/lib/db/sessions';
import { generateObjectWithFallback } from '@/lib/text-generator';

const requestSchema = z.object({
  description: z.string().trim().min(1).max(4000),
  providerId: z.string().trim().optional(),
  model: z.string().trim().optional(),
  currentConfig: z.object({
    name: z.string().optional(),
    systemPrompt: z.string().optional(),
    description: z.string().optional(),
  }).optional(),
});

const agentConfigSchema = z.object({
  name: z.string().describe('Agent 名称，简洁有力，2-10 个字'),
  systemPrompt: z.string().describe('详细的 Agent 系统提示词，明确定义角色、能力和行为约束'),
  description: z.string().describe('Agent 简介，一两句话说明用途'),
});

const SYSTEM_PROMPT = `你是专业的 AI Agent 设计师。这些 Agent 将作为工作流中的执行节点，接收调度代理分配的任务 prompt，完成后将结果传递给下游步骤。

根据用户描述，生成包含以下三个字段的 JSON 对象。所有字段内容必须使用中文。

name（2-8 字）
  简洁有力，直接体现 Agent 的核心能力。示例：数据分析师、代码审查专家、文案助手

description（1-2 句话）
  说明主要用途和适用的任务类型，帮助调度代理和用户判断何时选用此 Agent。

systemPrompt（200 字以上，中文）
  定义 Agent 在工作流步骤中的行为规范，必须包含：
  • 角色定位：明确专业领域和核心能力
  • 任务执行：如何处理收到的 prompt，以及如何利用上游步骤传入的 context
  • 上游数据处理：当 I/O Contract 中提供了上游步骤的产出物文件路径时，必须读取这些文件获取完整原始内容；不要重复抓取上游已经收集好的数据
  • 原始数据保存：搜索/爬取类 Agent 必须将获取到的完整原始内容保存为文件，禁止对原始内容做摘要或提炼后再保存；后续分析类步骤依赖完整原始数据进行深度分析
  • 文件输出：所有产出物（报告、数据文件、采集内容等）必须写入 I/O Contract 指定的 Artifact Output Dir，不要写入 shared 目录
  • 工作边界：只执行分配给本步骤的任务，完成后立即返回结果；不要提前做下游步骤的工作（例如：负责搜索的 Agent 只搜集资料，不做分析；负责分析的 Agent 基于提供的资料分析，不再重新搜索）
  • 输出规范：输出格式、质量要求，确保下游步骤可以直接消费结果
  结构清晰，直接可用于生产环境。

如果是浏览器操作类 Agent（涉及网页自动化、数据采集、表单填写、页面交互等），systemPrompt 中必须额外包含：
  • 工具调用顺序：每次操作前先调用 mcp__chrome-devtools__list_pages 获取可用页面及 pageId，再用该 pageId 调用其他工具
  • 多标签页约束：如果同一网站存在多个相似标签页，禁止凭标题猜测目标页；必须先核对 URL / 页面特征，再 select_page，或直接打开新的目标页避免串页
  • 页面分析：交互前调用 mcp__chrome-devtools__take_snapshot 获取页面可交互元素列表（每个元素有唯一 uid），点击或填写必须基于 snapshot 返回的 uid
  • 等待策略：登录、跳转、导出、慢页面加载优先使用 mcp__chrome-devtools__wait_for，timeoutMs 不要写 10000 / 15000 这类过短值；至少使用 30000，默认建议 60000 ~ 120000
  • 可用工具清单（在 systemPrompt 中明确列出）：
    - mcp__chrome-devtools__list_pages — 列出所有标签页
    - mcp__chrome-devtools__new_page — 打开新标签页，参数 url
    - mcp__chrome-devtools__navigate_page — 导航，参数 pageId、type(url/back/forward/reload)、url
    - mcp__chrome-devtools__take_snapshot — 获取页面结构和可交互元素（uid），参数 pageId
    - mcp__chrome-devtools__click — 点击元素，参数 pageId、uid
    - mcp__chrome-devtools__fill — 清空并填写输入框，参数 pageId、uid、value
    - mcp__chrome-devtools__type_text — 向聚焦元素输入文字，参数 pageId、text、submitKey(Enter/Tab)
    - mcp__chrome-devtools__take_screenshot — 截图保存为 PNG 文件，参数 pageId、filePath（必填绝对路径）；截图由 Electron 直接写入文件，禁止再用其他工具重写文件内容
    - mcp__chrome-devtools__evaluate_script — 执行 JavaScript，参数 pageId、expression
    - mcp__chrome-devtools__wait_for — 等待文字出现，参数 pageId、text(数组)、timeoutMs
    - mcp__chrome-devtools__close_page — 关闭标签页，参数 pageId
  • 登录态说明：浏览器与用户共享登录态，可直接访问用户已登录的网站，无需重新认证

直接输出 JSON，不添加任何解释文字。`;

function resolveProviderAndModel(requestedProviderId?: string, requestedModel?: string) {
  // Prefer: request param > settings config > default provider
  const configuredProviderId = getSetting('agent_creation_provider_id') || '';
  const configuredModel = getSetting('agent_creation_model') || '';

  const effectiveProviderId = requestedProviderId || configuredProviderId;
  const provider = effectiveProviderId
    ? getProvider(effectiveProviderId)
    : getDefaultProvider();

  const providerId = provider?.id || effectiveProviderId;
  if (!providerId) {
    throw new Error('未找到可用的 AI 服务商，请先在设置中配置服务商。');
  }

  const model = requestedModel || configuredModel || (() => {
    const catalog = provider ? JSON.parse(provider.model_catalog || '[]') as Array<{ value?: string }> : [];
    return catalog[0]?.value || '';
  })();

  if (!model) {
    throw new Error('未找到可用的模型，请在服务商中配置模型或手动指定。');
  }

  return { providerId, model };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { description, providerId: reqProviderId, model: reqModel, currentConfig } = requestSchema.parse(body);

    const { providerId, model } = resolveProviderAndModel(reqProviderId, reqModel);

    const currentConfigBlock = currentConfig && (currentConfig.name || currentConfig.systemPrompt)
      ? `\n\n当前 Agent 配置（请在此基础上修改）：\n名称：${currentConfig.name || '（未设置）'}\n简介：${currentConfig.description || '（未设置）'}\n系统提示词：\n${currentConfig.systemPrompt || '（未设置）'}`
      : '';

    const configuredPrompt = getSetting('agent_creation_system_prompt') || '';
    const config = await generateObjectWithFallback({
      providerId,
      model,
      system: configuredPrompt || SYSTEM_PROMPT,
      prompt: `用户需求：${description}${currentConfigBlock}`,
      schema: agentConfigSchema,
      maxTokens: 1024,
    });

    return NextResponse.json({ config });
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成失败，请重试';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
