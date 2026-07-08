/**
 * 微信连接器 — 统一命名空间（R3）。
 *
 * 修掉的事故：Ask 模式下微信能力整体蒸发、agent 误抓 goofish_get_inbox。
 *
 * - agent 的微信能力 = in-process `lumos-wechat-assistant`（读 Lumos 镜像，
 *   与原始 wechat-export stdio MCP 无关），**恒注入**（不再被 permissionMode 闸）。
 * - `wechat-export` 是内部后端，alwaysSkip——永不直接对模型广告。
 * - readiness 只改 hint 文案（R1）：未完成 能力→微信 授权时，hint 明确告知
 *   「可读但镜像可能为空，去授权」，而不是让工具消失导致 AI 假装没有能力。
 */
import {
  createWeChatAssistantMcpServer,
  WECHAT_ASSISTANT_MCP_SYSTEM_HINT,
  WECHAT_ASSISTANT_READONLY_MCP_SYSTEM_HINT,
} from '@/lib/tools/wechat-assistant-mcp-server';
import { getMcpServerByNameAndScope } from '@/lib/db';
import { WECHAT_EXPORT_MCP_NAME } from '@/lib/mcp-internal-backends';
import type {
  ConnectorContext,
  ConnectorDefinition,
  ConnectorReadiness,
} from '../types';

const NEEDS_SETUP_NOTE =
  '\n\n注意：本地微信镜像可能尚未同步（用户还没在「能力 → 微信」完成授权与密钥提取）。' +
  '工具仍可调用——先调用 get_wechat_assistant_status 看同步状态；若未同步，' +
  '如实告诉用户去「能力 → 微信」完成授权，不要假装没有微信能力，也不要改用其他平台的工具替代。';

/**
 * 微信工具是否只读。
 *
 * **必须只依赖会话稳定属性**（这里是 isDedicatedWeChatAssistantSession，
 * 由 session marker/title 决定，整个会话生命周期不变）。
 *
 * 为什么不能耦合 permissionMode：in-process MCP 的 resume 签名
 * （claude-client `buildMcpSignatureConfig`）**只按 server 名计算**，
 * 抓不到工具集变体。若 readOnly 随每轮 permissionMode 变（Code 可写、
 * Ask 只读），名字不变 → 签名不变 → SDK resume 旧会话 → Ask 模式里
 * 旧的可写微信进程仍然活着，"只读"被 resume 静默击穿。故工具集只能
 * 是会话稳定属性的纯函数；模式级"Ask 不写"由系统提示总钳（每轮重建、
 * resume 安全）兜，不在此做 resume 不安全的 toolset 变体切换。
 */
function isWeChatReadOnly(ctx: ConnectorContext): boolean {
  return !ctx.isDedicatedWeChatAssistantSession;
}

export const wechatConnector: ConnectorDefinition = {
  id: 'wechat',
  label: '微信',
  // 浏览器自动化意图下只保留浏览器连接器（等价旧 onlyBrowserMcpServers）。
  appliesTo: (ctx) => !ctx.browserAutomationIntent,
  resolve: (ctx) => ({
    // 内部后端：永不直接广告；agent 只用 in-process 助手。
    // resolver 已默认排除内部后端（mcp-internal-backends.ts）——此处保留是
    // registry 层的显式意图声明，使 dbMcpSkipNames 契约完整、present 集合正确。
    alwaysSkipDbMcpNames: [WECHAT_EXPORT_MCP_NAME],
    inProcess: () =>
      createWeChatAssistantMcpServer({ readOnly: isWeChatReadOnly(ctx) }),
  }),
  probeReadiness: (): ConnectorReadiness => {
    const mcp = getMcpServerByNameAndScope(WECHAT_EXPORT_MCP_NAME, 'builtin');
    if (mcp && mcp.is_enabled === 1) return { state: 'ready' };
    return {
      state: 'needs_setup',
      reason: 'wechat-export 未启用，本地镜像可能为空',
      actionHint: '能力 → 微信 完成授权与密钥提取',
    };
  },
  buildHint: (ctx, readiness) => {
    // hint 必须与实际注入的工具集一致：只读时给只读 hint，否则 agent
    // 会被告知能建/删自动化但工具不在场（"以为有其实没有"那类 bug）。
    const base = isWeChatReadOnly(ctx)
      ? WECHAT_ASSISTANT_READONLY_MCP_SYSTEM_HINT
      : WECHAT_ASSISTANT_MCP_SYSTEM_HINT;
    return readiness.state === 'ready' ? base : base + NEEDS_SETUP_NOTE;
  },
  // R4 第三通道：微信读工具是只读检索，Ask 模式应与知识/管家一样放行
  // ——这是「Ask 模式 agent 说没有微信工具」事故的第三处修复点。
  askModeReadAllowance: () =>
    'read-only WeChat history tools (lumos-wechat-assistant: search_wechat_messages / read_wechat_chat / export_wechat_my_messages / get_wechat_assistant_status) when the user asks about WeChat messages, chats, history, or exporting messages sent by them',
};
