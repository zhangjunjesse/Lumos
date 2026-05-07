import { buildWeChatAssistantAnalysis, type WeChatSnapshot } from '@/lib/wechat-assistant/analysis';

describe('buildWeChatAssistantAnalysis', () => {
  test('reports all-readable scan coverage and safety truncation', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const snapshot: WeChatSnapshot = {
      sessions: [{
        wxid: 'wxid_friend',
        display: '张三',
        unread_count: 1,
        last_timestamp: nowSeconds,
      }],
      messages: [{
        wxid: 'wxid_friend',
        display: '张三',
        isGroup: false,
        ts: nowSeconds,
        sender: 'them',
        type: 1,
        content: '麻烦今天确认一下合同报价',
      }],
      sessionsScanned: 1,
      messagesScanned: 1,
      totalReadableMessages: 60000,
      selectedReadableMessages: 60000,
      messagesTruncated: true,
      scanScope: 'all_readable_wechat_messages',
      safetyLimit: 50000,
    };

    const analysis = buildWeChatAssistantAnalysis(snapshot);

    expect(analysis.source.scope).toBe('本机微信可读取消息');
    expect(analysis.source.totalReadableMessages).toBe(60000);
    expect(analysis.source.messagesTruncated).toBe(true);
    expect(analysis.metrics.find((item) => item.label === '分析消息')?.detail).toBe('达到安全上限 50000 条');
    expect(analysis.todos).toHaveLength(1);
  });

  test('mines shareable content topics from chats and relationship signals', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const snapshot: WeChatSnapshot = {
      sessions: [
        {
          wxid: 'wxid_client',
          display: '客户 A',
          unread_count: 0,
          last_timestamp: nowSeconds,
        },
        {
          wxid: 'work_chat@chatroom',
          display: '项目群',
          unread_count: 2,
          last_timestamp: nowSeconds - 60,
          is_group: true,
        },
        {
          wxid: 'wxid_friend',
          display: '朋友 B',
          unread_count: 0,
          last_timestamp: nowSeconds - 120,
        },
      ],
      messages: [
        {
          wxid: 'wxid_client',
          display: '客户 A',
          isGroup: false,
          ts: nowSeconds,
          sender: 'them',
          type: 1,
          content: '麻烦今天确认合同付款，我这边卡住了',
        },
        {
          wxid: 'work_chat@chatroom',
          display: '项目群',
          isGroup: true,
          ts: nowSeconds - 60,
          sender: 'them',
          type: 1,
          content: '最近 AI 模型变化太快，怎么给客户解释方案价值？',
        },
        {
          wxid: 'wxid_friend',
          display: '朋友 B',
          isGroup: false,
          ts: nowSeconds - 120,
          sender: 'them',
          type: 1,
          content: '这个方案需要确认报价和付款流程',
        },
        {
          wxid: 'work_chat@chatroom',
          display: '项目群',
          isGroup: true,
          ts: nowSeconds - 180,
          sender: 'them',
          type: 1,
          content: '有没有报价避坑资料可以分享？',
        },
      ],
      sessionsScanned: 3,
      messagesScanned: 4,
      totalReadableMessages: 4,
      selectedReadableMessages: 4,
      messagesTruncated: false,
      scanScope: 'all_readable_wechat_messages',
      safetyLimit: 50000,
    };

    const analysis = buildWeChatAssistantAnalysis(snapshot);
    const moneyTopic = analysis.contentInsights.topics.find((item) => item.id === 'money');

    expect(moneyTopic).toBeDefined();
    expect(moneyTopic?.conversationCount).toBeGreaterThanOrEqual(2);
    expect(moneyTopic?.score).toBeGreaterThanOrEqual(50);
    expect(moneyTopic?.interestLabel).toMatch(/痛点|情绪|求解|场景/);
    expect(moneyTopic?.interestReason).toContain('代表片段');
    expect(moneyTopic?.spreadLabel).toMatch(/传播|发酵|热点/);
    expect(moneyTopic?.spreadNarrative).toContain('单聊');
    expect(analysis.contentInsights.relationshipSignals.some((item) => item.label === '群聊传播测试场')).toBe(true);
    expect(analysis.contentInsights.drafts.length).toBeGreaterThan(0);
    expect(analysis.contentInsights.drafts[0].privacyNote).toContain('隐去');
    expect(analysis.contentInsights.channelSuggestions.map((item) => item.channel)).toEqual([
      '朋友圈',
      '公众号',
      '短视频',
      '选题库',
    ]);
    expect(analysis.contentInsights.channelSuggestions[0].nextAction).toContain('改写');
  });

  test('keeps visible analysis fields free of internal ids', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const snapshot: WeChatSnapshot = {
      sessions: [
        {
          wxid: '45434442516@chatroom',
          display: '45434442516@chatroom',
          unread_count: 1,
          last_timestamp: nowSeconds,
          is_group: true,
        },
        {
          wxid: '25984985930267888@openim',
          display: '25984985930267888@openim',
          unread_count: 0,
          last_timestamp: nowSeconds - 60,
        },
      ],
      messages: [
        {
          wxid: '45434442516@chatroom',
          display: '45434442516@chatroom',
          isGroup: true,
          ts: nowSeconds,
          sender: 'them',
          type: 1,
          content: '25984985930267888@openim: 麻烦今天确认合同付款',
        },
        {
          wxid: '25984985930267888@openim',
          display: '25984985930267888@openim',
          isGroup: false,
          ts: nowSeconds - 60,
          sender: 'me',
          type: 1,
          content: '25984985930267888@openim: 我明天发方案',
        },
      ],
      sessionsScanned: 2,
      messagesScanned: 2,
      totalReadableMessages: 2,
      selectedReadableMessages: 2,
      messagesTruncated: false,
      scanScope: 'all_readable_wechat_messages',
      safetyLimit: 50000,
    };

    const analysis = buildWeChatAssistantAnalysis(snapshot);
    const displayed = JSON.stringify({
      summary: analysis.summary,
      metrics: analysis.metrics,
      highlights: analysis.highlights.map((item) => ({
        title: item.title,
        description: item.description,
        display: item.display,
      })),
      todos: analysis.todos.map((item) => ({ text: item.text, display: item.display })),
      topConversations: analysis.topConversations.map((item) => item.display),
      contentInsights: {
        topics: analysis.contentInsights.topics.map((topic) => ({
          examples: topic.examples,
          sources: topic.sources.map((source) => source.display),
        })),
        relationships: analysis.contentInsights.relationshipSignals.map((signal) => ({
          contacts: signal.contacts.map((contact) => contact.display),
        })),
      },
    });

    expect(displayed).toContain('微信群聊');
    expect(displayed).toContain('微信联系人');
    expect(displayed).not.toContain('@openim');
    expect(displayed).not.toContain('@chatroom');
    expect(displayed).not.toContain('45434442516');
  });
});
