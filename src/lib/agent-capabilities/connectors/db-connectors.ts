/**
 * DB-backed stdio MCP 连接器。
 *
 * 共性：appliesTo 排除 browserAutomationIntent（等价旧 onlyBrowserMcpServers——
 * chrome-devtools 例外，浏览器意图下唯一存活）。hint 走 buildDbHint（phase 2，
 * 仅当该 server 实际加载才广告），且**恒附不受 permissionMode 影响（R2）**——
 * 这是修掉「Ask 模式吞掉发现/能力提示」的关键。
 *
 * always-on 契约（defaultEnabledDbMcpNames）取代 init-builtin-resources 的
 * `||` 硬链：goofish-search/x-platform/douyin-collector 这些「未登录返回结构化
 * not-ready 而非工具消失」的连接器在此声明，注册即契约。
 */
import { IM_TOOLS_SYSTEM_HINT } from '@/lib/im';
import type { ConnectorContext, ConnectorDefinition } from '../types';
import {
  BROWSER_CONTEXT_SYSTEM_HINT_PREFIX,
  BROWSER_MCP_SYSTEM_HINT,
  DEEPSEARCH_MCP_SYSTEM_HINT,
  FEISHU_MCP_SYSTEM_HINT,
  DOUYIN_MCP_SYSTEM_HINT,
} from '../hints';

const notBrowser = (ctx: ConnectorContext) => !ctx.browserAutomationIntent;
const present = (set: Set<string>, ...names: string[]) => names.some((n) => set.has(n));

/** 闲鱼：本地存档可用、未登录返回结构化空，永远在（不再被误当微信替代品的根因之一已由 wechat 恒注入解决）。 */
const goofishConnector: ConnectorDefinition = {
  id: 'goofish',
  label: '闲鱼',
  appliesTo: notBrowser,
  resolve: () => ({
    ownedDbMcpNames: ['goofish-search'],
    defaultEnabledDbMcpNames: ['goofish-search'],
  }),
};

/** 抖音采集：未实现底层返回 ok:false+结构化原因，默认启用让 AI 诚实告知。 */
const douyinConnector: ConnectorDefinition = {
  id: 'douyin',
  label: '抖音',
  appliesTo: notBrowser,
  resolve: () => ({
    ownedDbMcpNames: ['douyin-collector'],
    defaultEnabledDbMcpNames: ['douyin-collector'],
  }),
  buildDbHint: (_ctx, presentDbServers) =>
    presentDbServers.has('douyin-collector') ? DOUYIN_MCP_SYSTEM_HINT : null,
};

/** X：未登录返回 X_AUTH_EXPIRED 友好提示，默认启用让 AI 引导登录。 */
const xConnector: ConnectorDefinition = {
  id: 'x',
  label: 'X / Twitter',
  appliesTo: notBrowser,
  resolve: () => ({
    ownedDbMcpNames: ['x-platform'],
    defaultEnabledDbMcpNames: ['x-platform'],
  }),
};

const feishuConnector: ConnectorDefinition = {
  id: 'feishu',
  label: '飞书',
  appliesTo: notBrowser,
  resolve: () => ({ ownedDbMcpNames: ['feishu'] }),
  buildDbHint: (_ctx, presentDbServers) =>
    presentDbServers.has('feishu') ? FEISHU_MCP_SYSTEM_HINT : null,
};

const deepsearchConnector: ConnectorDefinition = {
  id: 'deepsearch',
  label: 'DeepSearch',
  appliesTo: notBrowser,
  resolve: () => ({ ownedDbMcpNames: ['deepsearch'] }),
  buildDbHint: (_ctx, presentDbServers) =>
    presentDbServers.has('deepsearch') ? DEEPSEARCH_MCP_SYSTEM_HINT : null,
};

const imToolsConnector: ConnectorDefinition = {
  id: 'im-tools',
  label: 'IM 发送',
  appliesTo: notBrowser,
  resolve: () => ({ ownedDbMcpNames: ['im-tools'] }),
  buildDbHint: (_ctx, presentDbServers) =>
    presentDbServers.has('im-tools') ? IM_TOOLS_SYSTEM_HINT : null,
};

/** 浏览器控制：唯一在 browserAutomationIntent 下仍存活的连接器。 */
const chromeDevtoolsConnector: ConnectorDefinition = {
  id: 'chrome-devtools',
  label: '浏览器控制',
  // appliesTo 恒真（默认）。
  resolve: () => ({ ownedDbMcpNames: ['chrome-devtools', 'chrome_devtools'] }),
  buildDbHint: (ctx, presentDbServers) => {
    if (!present(presentDbServers, 'chrome-devtools', 'chrome_devtools')) return null;
    let hint = BROWSER_MCP_SYSTEM_HINT;
    const label = ctx.selectedBrowserLabel || '';
    hint +=
      `\n\n${BROWSER_CONTEXT_SYSTEM_HINT_PREFIX}: \`${label}\`.\n` +
      'If the user names a configured browser/profile such as "浏览器1", use the selected Lumos browser context via chrome-devtools tools. Do not use shell commands, system open commands, or the OS default browser as a fallback for browser/profile requests. If chrome-devtools fails, report the failure and the selected context instead of opening Google Chrome.';
    if (ctx.browserAutomationIntent) {
      hint +=
        '\nThis request explicitly targets browser control. Use chrome_devtools tools only for the browser action. Bash and DeepSearch are unavailable for this browser action, so do not attempt `open`, `osascript`, `curl`, system-browser, or DeepSearch fallbacks.';
    }
    if (ctx.visibleBrowserIntent) {
      hint +=
        '\nThe user asked to open or navigate a page. Prefer `mcp__chrome_devtools__new_page` with the target URL and keep it visible in the selected browser context.';
    }
    return hint;
  },
};

export const dbConnectors: ConnectorDefinition[] = [
  goofishConnector,
  douyinConnector,
  xConnector,
  feishuConnector,
  deepsearchConnector,
  imToolsConnector,
  chromeDevtoolsConnector,
];
