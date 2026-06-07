/**
 * In-process MCP 连接器（createSdkMcpServer 产物）。
 *
 * R1/R2 边界澄清：permissionMode 不是 readiness；它是会话结构事实。
 * R2 只禁止 permissionMode 删「读/消息」连接器与其广告（微信读、发现提示、
 * feishu/deepsearch/im hint 即此前的事故）。**写/exec 类连接器（如 lumos
 * 图像生成）在 default/ask 文本模式下不暴露是既定产品策略，非回归**——
 * 故 lumos.appliesTo 仍读 permissionMode，与旧行为逐字一致。
 */
import { createLumosMcpServer } from '@/lib/tools/lumos-mcp-server';
import {
  createLumosButlerMcpServer,
  LUMOS_BUTLER_MCP_SYSTEM_HINT,
} from '@/lib/tools/lumos-butler-mcp-server';
import {
  createLumosIssueReporterMcpServer,
  LUMOS_ISSUE_REPORTER_MCP_SYSTEM_HINT,
} from '@/lib/tools/lumos-issue-reporter-mcp-server';
import { createWorkflowMcpServer } from '@/lib/tools/workflow-mcp-server';
import { createEcommerceAssistantMcpServer } from '@/lib/tools/ecommerce-assistant-mcp-server';
import { createEtsyForgeMcpServer, ETSY_FORGE_MCP_SYSTEM_HINT } from '@/lib/tools/etsy-forge-mcp-server';
import {
  createChatKnowledgeMcpServer,
  CHAT_KNOWLEDGE_MCP_SYSTEM_HINT,
} from '@/lib/knowledge/chat-knowledge-mcp';
import type { ConnectorContext, ConnectorDefinition } from '../types';

const notBrowser = (ctx: ConnectorContext) => !ctx.browserAutomationIntent;

/** 图像生成（写/exec 类）——default/ask 文本模式不暴露属既定策略。 */
const lumosImageConnector: ConnectorDefinition = {
  id: 'lumos-image',
  label: '图像生成',
  appliesTo: (ctx) =>
    ctx.permissionMode !== 'default' &&
    !ctx.browserAutomationIntent &&
    !ctx.legacyImageAgentPrompt,
  resolve: (ctx) => ({
    inProcess: () => createLumosMcpServer(ctx.sessionId, ctx.userId),
  }),
};

/** 知识库（读类）——条件为结构事实，与 permissionMode 无关。 */
const knowledgeConnector: ConnectorDefinition = {
  id: 'knowledge',
  label: '知识库',
  appliesTo: (ctx) => ctx.knowledgeEnabledForRequest && !ctx.browserAutomationIntent,
  resolve: (ctx) => ({
    inProcess: () =>
      createChatKnowledgeMcpServer({
        tagIds: ctx.selectedKnowledgeTagIds,
        overrides: ctx.knowledgeOverrides,
      }),
    // R5：知识工具行为依赖每轮可变的 tagIds/overrides——必须进 resume
    // 签名，否则用户会话中途改知识库范围/检索参数后 resume 仍按旧范围。
    inProcessVariantKey: JSON.stringify({
      t: [...ctx.selectedKnowledgeTagIds].sort(),
      o: ctx.knowledgeOverrides ?? null,
    }),
  }),
  buildHint: () => CHAT_KNOWLEDGE_MCP_SYSTEM_HINT,
  // R4：措辞与旧 buildAskModeToolAllowance 逐字一致（零回归）。
  askModeReadAllowance: () =>
    'read-only Lumos knowledge tools when they are needed to answer from the enabled knowledge base',
};

/** 主 agent 管家（读/编排类）。 */
const butlerConnector: ConnectorDefinition = {
  id: 'lumos-butler',
  label: '主 Agent 管家',
  appliesTo: (ctx) => ctx.isPrimaryMainAgentSession && !ctx.browserAutomationIntent,
  resolve: (ctx) => ({
    inProcess: () =>
      createLumosButlerMcpServer({ sessionId: ctx.sessionId, userId: ctx.userId }),
  }),
  buildHint: () => LUMOS_BUTLER_MCP_SYSTEM_HINT,
  // R4：措辞与旧 buildAskModeToolAllowance 逐字一致（零回归）。
  askModeReadAllowance: () =>
    'read-only Lumos butler tools when the user asks about Lumos status, settings, history, tasks, or installed capabilities',
};

/** Lumos bug 上报：写 GitHub Issue，工具内部按真实登录邮箱做白名单校验。 */
const issueReporterConnector: ConnectorDefinition = {
  id: 'lumos-issue-reporter',
  label: 'Lumos Bug 上报',
  appliesTo: notBrowser,
  resolve: (ctx) => ({
    inProcess: () =>
      createLumosIssueReporterMcpServer({ sessionId: ctx.sessionId, userId: ctx.userId }),
  }),
  buildHint: () => LUMOS_ISSUE_REPORTER_MCP_SYSTEM_HINT,
  askModeReadAllowance: () =>
    'the Lumos issue reporter tool only when the user explicitly asks to submit/report a Lumos bug to GitHub; the tool must verify the logged-in email allowlist and must not claim success without an issue URL',
};

/** Workflow 代码运行器——仅 workflow 专属会话。 */
const workflowConnector: ConnectorDefinition = {
  id: 'workflow',
  label: 'Workflow',
  appliesTo: (ctx) => ctx.isWorkflowChatSession && !ctx.browserAutomationIntent,
  resolve: () => ({ inProcess: () => createWorkflowMcpServer() }),
};

/** 电商助手——仅电商专属会话。 */
const ecommerceConnector: ConnectorDefinition = {
  id: 'ecommerce',
  label: '电商助手',
  appliesTo: (ctx) => ctx.isEcommerceAssistantChatSession && !ctx.browserAutomationIntent,
  resolve: () => ({ inProcess: () => createEcommerceAssistantMcpServer() }),
};

/** Etsy 出图——主 agent 会话常驻(微信发图/商品链接 → 二创产品图落「我的产品」)。 */
const etsyForgeConnector: ConnectorDefinition = {
  id: 'etsy-forge',
  label: 'Etsy 出图',
  appliesTo: (ctx) => ctx.isPrimaryMainAgentSession && !ctx.browserAutomationIntent,
  resolve: () => ({ inProcess: () => createEtsyForgeMcpServer() }),
  buildHint: () => ETSY_FORGE_MCP_SYSTEM_HINT,
};

export const inProcessConnectors: ConnectorDefinition[] = [
  lumosImageConnector,
  knowledgeConnector,
  butlerConnector,
  issueReporterConnector,
  workflowConnector,
  ecommerceConnector,
  etsyForgeConnector,
];
