jest.mock('@/lib/wechat-export/api-bridge', () => ({
  queryWeChatApi: jest.fn(),
}));
jest.mock('@/lib/wechat-export/disclaimer', () => ({
  hasValidConsent: jest.fn(),
}));
jest.mock('@/lib/wechat-export/setup-state', () => ({
  hasRecoveredKey: jest.fn(),
}));
jest.mock('@/lib/wechat-assistant/ai-runner', () => ({
  getLatestAIAnalysis: jest.fn(),
  runAIAnalysis: jest.fn(),
  WeChatAIAnalysisError: class WeChatAIAnalysisError extends Error {
    code = 'mock_error';
  },
}));

import { normalizeSnapshot } from '../route';

describe('wechat ai-analysis route helpers', () => {
  it('keeps group sender metadata from analyze_snapshot', () => {
    const snapshot = normalizeSnapshot({
      sessions: [{
        wxid: 'team@chatroom',
        display: '项目群',
        is_group: true,
      }],
      messages: [{
        wxid: 'team@chatroom',
        display: '项目群',
        is_group: true,
        ts: 1_700_000_000,
        sender: 'them',
        sender_wxid: 'wxid_zhangsan',
        sender_display: '张三',
        type: 1,
        content: '麻烦整理节前遗留问题',
      }],
    });

    expect(snapshot.messages[0]).toEqual(expect.objectContaining({
      wxid: 'team@chatroom',
      sender: 'them',
      senderWxid: 'wxid_zhangsan',
      senderDisplay: '张三',
      content: '麻烦整理节前遗留问题',
    }));
  });
});
