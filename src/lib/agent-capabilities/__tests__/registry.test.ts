/**
 * 能力注册中心不变量测试。
 *
 * 这些断言是「微信工具反复消失/误抓闲鱼」事故不再复发的硬保证：
 * - R1 工具可见性与就绪态解耦
 * - R2 权限模式不删读/消息能力与广告
 * - R3 命名空间一致、wechat-export 恒为内部后端
 * 外加逐连接器零回归点位。
 */

jest.mock('@/lib/tools/wechat-assistant-mcp-server', () => ({
  createWeChatAssistantMcpServer: jest.fn((o?: { readOnly?: boolean }) => ({
    name: 'lumos-wechat-assistant',
    readOnly: !!o?.readOnly,
  })),
  WECHAT_ASSISTANT_MCP_SYSTEM_HINT: 'WECHAT_FULL_HINT',
  WECHAT_ASSISTANT_READONLY_MCP_SYSTEM_HINT: 'WECHAT_RO_HINT',
}));
jest.mock('@/lib/db', () => ({
  getMcpServerByNameAndScope: jest.fn(),
}));
jest.mock('@/lib/im', () => ({ IM_TOOLS_SYSTEM_HINT: 'IM_TOOLS_HINT_TEXT' }));
jest.mock('@/lib/tools/lumos-mcp-server', () => ({
  createLumosMcpServer: () => ({ name: 'lumos-image' }),
}));
jest.mock('@/lib/tools/lumos-butler-mcp-server', () => ({
  createLumosButlerMcpServer: () => ({ name: 'lumos-butler' }),
  LUMOS_BUTLER_MCP_SYSTEM_HINT: 'BUTLER_HINT_TEXT',
}));
jest.mock('@/lib/tools/lumos-issue-reporter-mcp-server', () => ({
  createLumosIssueReporterMcpServer: () => ({ name: 'lumos-issue-reporter' }),
  LUMOS_ISSUE_REPORTER_MCP_SYSTEM_HINT: 'ISSUE_REPORTER_HINT_TEXT',
}));
jest.mock('@/lib/tools/workflow-mcp-server', () => ({
  createWorkflowMcpServer: () => ({ name: 'workflow-runner' }),
}));
jest.mock('@/lib/tools/ecommerce-assistant-mcp-server', () => ({
  createEcommerceAssistantMcpServer: () => ({ name: 'ecommerce-assistant' }),
}));
jest.mock('@/lib/knowledge/chat-knowledge-mcp', () => ({
  createChatKnowledgeMcpServer: jest.fn(() => ({ name: 'chat-knowledge' })),
  CHAT_KNOWLEDGE_MCP_SYSTEM_HINT: 'KNOWLEDGE_HINT_TEXT',
}));

import {
  buildCapabilityPlan,
  buildDbServerHints,
  buildAskModeAllowance,
  defaultEnabledDbMcpNames,
} from '../registry';
import type { ConnectorContext } from '../types';
import { DEFAULT_ENABLED_DB_MCP_NAMES } from '../default-enabled';
import { getMcpServerByNameAndScope } from '@/lib/db';
import { createChatKnowledgeMcpServer } from '@/lib/knowledge/chat-knowledge-mcp';

const mockedGetMcp = getMcpServerByNameAndScope as jest.MockedFunction<
  typeof getMcpServerByNameAndScope
>;

function ctx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    sessionId: 's',
    userId: 'u',
    permissionMode: 'acceptEdits',
    browserAutomationIntent: false,
    visibleBrowserIntent: false,
    isPrimaryMainAgentSession: false,
    isDedicatedWeChatAssistantSession: false,
    isWorkflowChatSession: false,
    isEcommerceAssistantChatSession: false,
    knowledgeEnabledForRequest: false,
    selectedKnowledgeTagIds: [],
    ...overrides,
  };
}

const setWeChatEnabled = (enabled: boolean) =>
  mockedGetMcp.mockReturnValue(
    { is_enabled: enabled ? 1 : 0 } as ReturnType<typeof getMcpServerByNameAndScope>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  setWeChatEnabled(true);
});

describe('R1 工具可见性与就绪态解耦', () => {
  test('微信 readiness 翻转不改变工具集，只改 hint 文案', () => {
    setWeChatEnabled(true);
    const ready = buildCapabilityPlan(ctx());
    setWeChatEnabled(false);
    const notReady = buildCapabilityPlan(ctx());

    expect(Object.keys(ready.inProcessServers).sort()).toEqual(
      Object.keys(notReady.inProcessServers).sort(),
    );
    expect([...ready.dbMcpSkipNames].sort()).toEqual(
      [...notReady.dbMcpSkipNames].sort(),
    );
    expect(Object.keys(ready.inProcessServers)).toContain('lumos-wechat-assistant');
    // 仅文案不同：未就绪追加「去能力→微信」引导，工具仍在。
    expect(ready.systemHintAppend).toContain('WECHAT_RO_HINT');
    expect(ready.systemHintAppend).not.toContain('能力 → 微信');
    expect(notReady.systemHintAppend).toContain('WECHAT_RO_HINT');
    expect(notReady.systemHintAppend).toContain('能力 → 微信');
  });

  test('readiness 探针抛错时退化为 ready，工具不消失', () => {
    mockedGetMcp.mockImplementation(() => {
      throw new Error('db down');
    });
    const p = buildCapabilityPlan(ctx());
    expect(Object.keys(p.inProcessServers)).toContain('lumos-wechat-assistant');
    expect(p.systemHintAppend).toContain('WECHAT_RO_HINT');
  });
});

describe('R2 权限模式不删读/消息能力与广告', () => {
  test('Ask(default) 与 Code(acceptEdits) 微信工具+hint 均在', () => {
    const ask = buildCapabilityPlan(ctx({ permissionMode: 'default' }));
    const code = buildCapabilityPlan(ctx({ permissionMode: 'acceptEdits' }));
    expect(Object.keys(ask.inProcessServers)).toContain('lumos-wechat-assistant');
    expect(Object.keys(code.inProcessServers)).toContain('lumos-wechat-assistant');
    expect(ask.systemHintAppend).toContain('WECHAT_RO_HINT');
  });

  test('DB hint(feishu/deepsearch/im) 恒附，不受 default 模式影响', () => {
    const present = new Set(['feishu', 'deepsearch', 'im-tools', 'douyin-collector']);
    const hint = buildDbServerHints(ctx({ permissionMode: 'default' }), present);
    expect(hint).toContain('Feishu MCP tools');
    expect(hint).toContain('DeepSearch');
    expect(hint).toContain('IM_TOOLS_HINT_TEXT');
    expect(hint).toContain('Douyin Collector MCP tools');
    expect(hint).toContain('Do not infer or simulate transcript content');
  });

  test('lumos-image 在普通聊天(default)也直接暴露(重构:替代老「图片助手」暗号协议)', () => {
    // 旧策略是 default 模式藏生图工具;重构后普通聊天/主 agent 都直接给 generate_image,让 AI 自己调。
    expect(
      Object.keys(buildCapabilityPlan(ctx({ permissionMode: 'default' })).inProcessServers),
    ).toContain('lumos-image');
    expect(
      Object.keys(buildCapabilityPlan(ctx({ permissionMode: 'acceptEdits' })).inProcessServers),
    ).toContain('lumos-image');
  });
});

describe('R3 命名空间一致 / 无闲鱼替代路径', () => {
  test('wechat-export 恒 skip 永不直接广告；微信单一 in-process 命名空间', () => {
    const p = buildCapabilityPlan(ctx());
    expect([...p.dbMcpSkipNames]).toContain('wechat-export');
    expect(Object.keys(p.inProcessServers)).toContain('lumos-wechat-assistant');
  });

  test('浏览器意图下 wechat-export 仍 alwaysSkip', () => {
    const p = buildCapabilityPlan(ctx({ browserAutomationIntent: true }));
    expect([...p.dbMcpSkipNames]).toContain('wechat-export');
  });

  test('dedicated 微信会话给全权工具 + FULL hint', () => {
    const d = buildCapabilityPlan(ctx({ isDedicatedWeChatAssistantSession: true }));
    expect(d.systemHintAppend).toContain('WECHAT_FULL_HINT');
    expect(d.systemHintAppend).not.toContain('WECHAT_RO_HINT');
  });
});

describe('微信工具集必须是会话稳定属性的纯函数（resume 签名只认名字）', () => {
  const wechatServer = (c: Parameters<typeof buildCapabilityPlan>[0]) =>
    buildCapabilityPlan(c).inProcessServers['lumos-wechat-assistant'] as unknown as {
      readOnly: boolean;
    };

  test('readOnly 只由 isDedicated 决定，与 permissionMode 无关（防 resume 击穿）', () => {
    // 专属会话：任何模式都同一工具集（可写）——否则名字不变、签名不变、
    // resume 会把旧变体带进新模式。模式级"Ask 不写"由提示总钳兜，不在此切 toolset。
    expect(wechatServer(ctx({ isDedicatedWeChatAssistantSession: true, permissionMode: 'acceptEdits' })).readOnly).toBe(false);
    expect(wechatServer(ctx({ isDedicatedWeChatAssistantSession: true, permissionMode: 'default' })).readOnly).toBe(false);
    expect(wechatServer(ctx({ isDedicatedWeChatAssistantSession: true, permissionMode: 'plan' })).readOnly).toBe(false);
  });

  test('非专属会话：恒只读（任何模式）', () => {
    expect(wechatServer(ctx({ permissionMode: 'acceptEdits' })).readOnly).toBe(true);
    expect(wechatServer(ctx({ permissionMode: 'default' })).readOnly).toBe(true);
    expect(wechatServer(ctx({ permissionMode: 'plan' })).readOnly).toBe(true);
  });

  test('hint 与注入工具集一致：专属=FULL，非专属=READONLY（同一 isWeChatReadOnly 真值源）', () => {
    expect(
      buildCapabilityPlan(ctx({ isDedicatedWeChatAssistantSession: true })).systemHintAppend,
    ).toContain('WECHAT_FULL_HINT');
    expect(buildCapabilityPlan(ctx()).systemHintAppend).toContain('WECHAT_RO_HINT');
  });
});

describe('R6 故障隔离：单连接器抛错不炸掉整张能力计划', () => {
  test('某 in-process 工厂抛错 → buildCapabilityPlan 不抛，其余连接器仍在', () => {
    const mockedKnowledge = createChatKnowledgeMcpServer as jest.MockedFunction<
      typeof createChatKnowledgeMcpServer
    >;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockedKnowledge.mockImplementationOnce(() => {
      throw new Error('knowledge engine init boom');
    });

    let plan!: ReturnType<typeof buildCapabilityPlan>;
    expect(() => {
      plan = buildCapabilityPlan(
        ctx({ knowledgeEnabledForRequest: true, isPrimaryMainAgentSession: true }),
      );
    }).not.toThrow();

    // 抛错的连接器被跳过，但其余能力完好——一个坏连接器不该让用户失去全部能力。
    expect(Object.keys(plan.inProcessServers)).not.toContain('chat-knowledge');
    expect(Object.keys(plan.inProcessServers)).toContain('lumos-wechat-assistant');
    expect(Object.keys(plan.inProcessServers)).toContain('lumos-butler');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('connector "knowledge" failed'),
      expect.anything(),
    );
    warn.mockRestore();
  });
});

describe('R5 in-process 变体指纹（防 resume 把旧配置带进新一轮）', () => {
  test('knowledge：变体指纹随 tagIds 变化（修预存潜在 bug：中途改知识库范围 resume 仍按旧范围）', () => {
    const a = buildCapabilityPlan(
      ctx({ knowledgeEnabledForRequest: true, selectedKnowledgeTagIds: ['t1'] }),
    );
    const b = buildCapabilityPlan(
      ctx({ knowledgeEnabledForRequest: true, selectedKnowledgeTagIds: ['t2'] }),
    );
    expect(a.inProcessVariantKeys['chat-knowledge']).toBeDefined();
    expect(a.inProcessVariantKeys['chat-knowledge']).not.toEqual(
      b.inProcessVariantKeys['chat-knowledge'],
    );
  });

  test('knowledge：tagId 顺序不同但集合相同 → 指纹稳定（不误触新会话）', () => {
    const a = buildCapabilityPlan(
      ctx({ knowledgeEnabledForRequest: true, selectedKnowledgeTagIds: ['a', 'b'] }),
    );
    const b = buildCapabilityPlan(
      ctx({ knowledgeEnabledForRequest: true, selectedKnowledgeTagIds: ['b', 'a'] }),
    );
    expect(a.inProcessVariantKeys['chat-knowledge']).toEqual(
      b.inProcessVariantKeys['chat-knowledge'],
    );
  });

  test('会话稳定的连接器（微信/管家）不产生变体指纹（等价 name-only，零额外开销）', () => {
    const p = buildCapabilityPlan(
      ctx({ isPrimaryMainAgentSession: true, isDedicatedWeChatAssistantSession: true }),
    );
    expect(p.inProcessVariantKeys['lumos-wechat-assistant']).toBeUndefined();
    expect(p.inProcessVariantKeys['lumos-butler']).toBeUndefined();
  });
});

describe('R4 第三通道：Ask 模式工具许可由注册中心驱动', () => {
  test('普通会话 Ask 模式：放行微信只读工具（事故第三处修复，旧实现此处为「Do not use any tools」）', () => {
    const clause = buildAskModeAllowance(ctx({ permissionMode: 'default' }));
    expect(clause).toContain('You may use only');
    expect(clause).toContain('lumos-wechat-assistant');
    expect(clause).toContain('WeChat');
    expect(clause).not.toBe(' Do not use any tools.');
  });

  test('零回归：knowledge / 主agent 措辞与旧 buildAskModeToolAllowance 一致', () => {
    const clause = buildAskModeAllowance(
      ctx({ permissionMode: 'default', knowledgeEnabledForRequest: true, isPrimaryMainAgentSession: true }),
    );
    expect(clause).toContain(
      'read-only Lumos knowledge tools when they are needed to answer from the enabled knowledge base',
    );
    expect(clause).toContain(
      'read-only Lumos butler tools when the user asks about Lumos status, settings, history, tasks, or installed capabilities',
    );
    // 微信也在场——三处白名单同源
    expect(clause).toContain('lumos-wechat-assistant');
  });

  test('浏览器自动化意图：微信不 appliesTo → 不在 Ask 许可里', () => {
    const clause = buildAskModeAllowance(ctx({ permissionMode: 'default', browserAutomationIntent: true }));
    expect(clause).not.toContain('lumos-wechat-assistant');
  });

  test('Ask 模式允许用户明确要求的 Lumos bug Issue 受控提交', () => {
    const clause = buildAskModeAllowance(ctx({ permissionMode: 'default' }));
    expect(clause).toContain('Lumos issue reporter tool');
    expect(clause).toContain('explicitly asks to submit/report a Lumos bug');
    expect(clause).toContain('issue URL');
  });

  test('浏览器自动化意图：Issue reporter 不在 Ask 许可里', () => {
    const clause = buildAskModeAllowance(ctx({ permissionMode: 'default', browserAutomationIntent: true }));
    expect(clause).not.toContain('Lumos issue reporter tool');
  });
});

describe('逐连接器零回归点位', () => {
  test('浏览器意图：无 in-process，非浏览器 DB 名进 skip，chrome 不进', () => {
    const p = buildCapabilityPlan(ctx({ browserAutomationIntent: true }));
    expect(Object.keys(p.inProcessServers)).toEqual([]);
    expect([...p.dbMcpSkipNames].sort()).toEqual(
      expect.arrayContaining([
        'deepsearch',
        'feishu',
        'im-tools',
        'goofish-search',
        'douyin-collector',
        'x-platform',
        'wechat-export',
      ]),
    );
    expect([...p.dbMcpSkipNames]).not.toContain('chrome-devtools');
  });

  test('butler：仅主 agent 非浏览器注入 + hint', () => {
    const main = buildCapabilityPlan(ctx({ isPrimaryMainAgentSession: true }));
    expect(Object.keys(main.inProcessServers)).toContain('lumos-butler');
    expect(main.systemHintAppend).toContain('BUTLER_HINT_TEXT');
    const notMain = buildCapabilityPlan(ctx());
    expect(Object.keys(notMain.inProcessServers)).not.toContain('lumos-butler');
  });

  test('knowledge：启用且非浏览器注入 + hint', () => {
    const k = buildCapabilityPlan(ctx({ knowledgeEnabledForRequest: true }));
    expect(Object.keys(k.inProcessServers)).toContain('chat-knowledge');
    expect(k.systemHintAppend).toContain('KNOWLEDGE_HINT_TEXT');
    const off = buildCapabilityPlan(ctx());
    expect(Object.keys(off.inProcessServers)).not.toContain('chat-knowledge');
  });

  test('lumos-issue-reporter：普通非浏览器会话注入 + hint，浏览器意图下移除', () => {
    const normal = buildCapabilityPlan(ctx());
    expect(Object.keys(normal.inProcessServers)).toContain('lumos-issue-reporter');
    expect(normal.systemHintAppend).toContain('ISSUE_REPORTER_HINT_TEXT');

    const browser = buildCapabilityPlan(ctx({ browserAutomationIntent: true }));
    expect(Object.keys(browser.inProcessServers)).not.toContain('lumos-issue-reporter');
  });

  test('workflow/ecommerce：仅对应专属会话注入', () => {
    const w = buildCapabilityPlan(ctx({ isWorkflowChatSession: true }));
    expect(Object.keys(w.inProcessServers)).toContain('workflow-runner');
    const e = buildCapabilityPlan(ctx({ isEcommerceAssistantChatSession: true }));
    expect(Object.keys(e.inProcessServers)).toContain('ecommerce-assistant');
  });

  test('defaultEnabledDbMcpNames 恰为 goofish-search/douyin-collector/x-platform', () => {
    expect(defaultEnabledDbMcpNames().sort()).toEqual([
      'douyin-collector',
      'goofish-search',
      'x-platform',
    ]);
  });

  test('焊接：轻量 DEFAULT_ENABLED_DB_MCP_NAMES 与连接器派生值不得漂移（init 启动路径只依赖前者）', () => {
    expect([...DEFAULT_ENABLED_DB_MCP_NAMES].sort()).toEqual(
      defaultEnabledDbMcpNames().sort(),
    );
  });

  test('普通会话非浏览器：goofish-search 不被 skip(仍可用)，但微信工具同时在场——杜绝误抓闲鱼', () => {
    const p = buildCapabilityPlan(ctx());
    expect([...p.dbMcpSkipNames]).not.toContain('goofish-search');
    expect(Object.keys(p.inProcessServers)).toContain('lumos-wechat-assistant');
  });
});
