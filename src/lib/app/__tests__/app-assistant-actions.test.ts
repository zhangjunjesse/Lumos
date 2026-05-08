import {
  parseAppAssistantActions,
  stripAppAssistantActionBlocks,
  supportsReplyDraftActions,
} from '../app-assistant-actions';
import type { AppManifest } from '../manifest/types';

describe('app assistant actions', () => {
  it('parses create_reply_draft action blocks', () => {
    const text = [
      '这是建议回复。',
      '[APP_ACTION]',
      JSON.stringify({
        type: 'create_reply_draft',
        buyer_name: '张三',
        item_title: '二手相机',
        conversation_id: 'cid-1',
        incoming_message: '能便宜点吗？',
        draft_text: '您好，可以小刀一点，平台内交易更安全。',
        reason: '买家询问议价，需要先保存一条保守回复草稿。',
        risk_note: '不承诺平台外交易。',
      }),
      '[/APP_ACTION]',
    ].join('\n');

    expect(parseAppAssistantActions(text)).toEqual([
      {
        type: 'create_reply_draft',
        buyerName: '张三',
        itemTitle: '二手相机',
        conversationId: 'cid-1',
        incomingMessage: '能便宜点吗？',
        draftText: '您好，可以小刀一点，平台内交易更安全。',
        reason: '买家询问议价，需要先保存一条保守回复草稿。',
        riskNote: '不承诺平台外交易。',
      },
    ]);
    expect(stripAppAssistantActionBlocks(text)).toBe('这是建议回复。');
  });

  it('ignores malformed or unsafe action blocks', () => {
    expect(parseAppAssistantActions('[APP_ACTION]not-json[/APP_ACTION]')).toEqual([]);
    expect(parseAppAssistantActions('[APP_ACTION]{"type":"send_message"}[/APP_ACTION]')).toEqual([]);
    expect(parseAppAssistantActions('[APP_ACTION]{"type":"create_reply_draft"}[/APP_ACTION]')).toEqual([]);
  });

  it('parses run_self_check action blocks', () => {
    const text = [
      '我可以帮你重新自检。',
      '[APP_ACTION]',
      JSON.stringify({
        type: 'run_self_check',
        reason: '用户要求检查应用是否可用',
      }),
      '[/APP_ACTION]',
    ].join('\n');

    expect(parseAppAssistantActions(text)).toEqual([
      {
        type: 'run_self_check',
        reason: '用户要求检查应用是否可用',
      },
    ]);
    expect(stripAppAssistantActionBlocks(text)).toBe('我可以帮你重新自检。');
  });

  it('only enables reply draft actions for Goofish-like apps', () => {
    const goofish: AppManifest = {
      id: 'goofish-assistant',
      name: '闲鱼助手',
      version: '1.0.0',
      icon: './icon.png',
      entry: 'inbox',
    };
    const generic: AppManifest = {
      id: 'crm',
      name: '客户跟进',
      version: '1.0.0',
      icon: './icon.png',
      entry: 'customers',
    };

    expect(supportsReplyDraftActions(goofish)).toBe(true);
    expect(supportsReplyDraftActions(generic)).toBe(false);
  });
});
