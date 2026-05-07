import { aiResponseSchema, enrichEvents, enrichTodos } from '../ai-event-shape';
import { buildAiPromptContext } from '../ai-prompt';
import { cropSnapshotForLlm, type LlmMessage } from '../ai-snapshot-crop';

function makeMsg(idx: number, overrides: Partial<LlmMessage> = {}): LlmMessage {
  return {
    idx,
    ts: 1_700_000_000 + idx,
    wxid: 'wxid_a',
    display: '张三',
    isGroup: false,
    sender: 'them',
    text: `msg ${idx}`,
    ...overrides,
  };
}

describe('aiResponseSchema', () => {
  it('rejects events with empty evidence', () => {
    expect(() =>
      aiResponseSchema.parse({
        events: [
          {
            title: 't',
            urgency: 'urgent',
            contactWxid: 'a',
            contactDisplay: 'A',
            isGroup: false,
            evidenceMsgIds: [],
            suggestedAction: 'do',
          },
        ],
        todos: [],
      }),
    ).toThrow();
  });

  it('rejects unknown urgency / source / confidence', () => {
    expect(() =>
      aiResponseSchema.parse({
        events: [
          {
            title: 't',
            urgency: 'maybe',
            contactWxid: 'a',
            contactDisplay: 'A',
            isGroup: false,
            evidenceMsgIds: [1],
            suggestedAction: 'do',
          },
        ],
        todos: [],
      }),
    ).toThrow();
  });
});

describe('enrichEvents', () => {
  it('drops events whose evidence ids do not exist in the cropped snapshot', () => {
    const byIdx = new Map<number, LlmMessage>([
      [1, makeMsg(1)],
      [2, makeMsg(2)],
    ]);
    const out = enrichEvents(
      [
        {
          title: 'real',
          urgency: 'urgent',
          contactWxid: 'a',
          contactDisplay: 'A',
          isGroup: false,
          evidenceMsgIds: [1, 99],
          suggestedAction: 'do',
        },
        {
          title: 'phantom',
          urgency: 'urgent',
          contactWxid: 'a',
          contactDisplay: 'A',
          isGroup: false,
          evidenceMsgIds: [42, 99],
          suggestedAction: 'do',
        },
      ],
      byIdx,
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('real');
    expect(out[0].evidenceMsgIds).toEqual([1]);
    expect(out[0].evidenceTexts).toEqual(['msg 1']);
    expect(out[0].lastAt).toBe(1_700_000_001);
  });

  it('maps prompt source aliases back to the real WeChat conversation', () => {
    const byIdx = new Map<number, LlmMessage>([
      [1, makeMsg(1, {
        wxid: '45434442516@chatroom',
        display: '45434442516 客户群',
        isGroup: true,
        text: '确认节前遗留问题',
      })],
    ]);
    const sourcesByKey = new Map([
      ['chat_1', {
        sourceKey: 'chat_1',
        wxid: '45434442516@chatroom',
        display: '客户群',
        isGroup: true,
      }],
    ]);

    const out = enrichEvents(
      [{
        title: '45434442516 客户群在催节前问题',
        urgency: 'urgent',
        contactWxid: 'chat_1',
        contactDisplay: 'chat_1',
        isGroup: false,
        evidenceMsgIds: [1],
        suggestedAction: '整理给 45434442516 客户群',
      }],
      byIdx,
      sourcesByKey,
    );

    expect(out[0]).toEqual(expect.objectContaining({
      title: '客户群在催节前问题',
      contactWxid: '45434442516@chatroom',
      contactDisplay: '客户群',
      isGroup: true,
      suggestedAction: '整理给 客户群',
    }));
  });
});

describe('enrichTodos', () => {
  it('attaches source text/display and drops phantom todos', () => {
    const byIdx = new Map<number, LlmMessage>([
      [3, makeMsg(3, { sender: 'me', text: '明天给你方案' })],
    ]);
    const out = enrichTodos(
      [
        {
          text: '明天给方案',
          source: 'self',
          sourceMsgId: 3,
          byWhenText: '明天',
          confidence: 'high',
        },
        {
          text: '幻觉',
          source: 'self',
          sourceMsgId: 999,
          byWhenText: null,
          confidence: 'medium',
        },
      ],
      byIdx,
    );
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('明天给方案');
    expect(out[0].sourceText).toBe('明天给你方案');
    expect(out[0].byWhenText).toBe('明天');
    expect(out[0].sourceWxid).toBe('wxid_a');
  });

  it('keeps suggested todos readable when source text contains openim ids', () => {
    const byIdx = new Map<number, LlmMessage>([
      [5, makeMsg(5, {
        wxid: '25984985930267888@openim',
        display: '25984985930267888@openim',
        text: '25984985930267888@openim: 5.6语文作业 订正默写本',
      })],
    ]);
    const out = enrichTodos(
      [{
        text: '提醒 25984985930267888@openim 订正默写本',
        source: 'other',
        sourceMsgId: 5,
        byWhenText: null,
        confidence: 'high',
      }],
      byIdx,
    );

    expect(out[0].text).toBe('提醒 订正默写本');
    expect(out[0].sourceText).toBe('5.6语文作业 订正默写本');
    expect(out[0].sourceDisplay).toBe('微信联系人');
  });

  it('does not fall back to raw internal ids when sanitizing removes the whole todo', () => {
    const byIdx = new Map<number, LlmMessage>([
      [6, makeMsg(6, {
        wxid: '25984985930267888@openim',
        display: '25984985930267888@openim',
        text: '25984985930267888@openim',
      })],
    ]);
    const out = enrichTodos(
      [{
        text: '25984985930267888@openim',
        source: 'other',
        sourceMsgId: 6,
        byWhenText: '25984985930267888',
        confidence: 'medium',
      }],
      byIdx,
    );

    expect(out[0].text).toBe('微信待跟进事项');
    expect(out[0].sourceText).toBeNull();
    expect(out[0].byWhenText).toBeNull();
    expect([
      out[0].text,
      out[0].sourceText,
      out[0].sourceDisplay,
      out[0].sourceSenderDisplay,
      out[0].byWhenText,
    ].join('\n')).not.toContain('25984985930267888');
  });

  it('attaches group sender display when the mirror has it', () => {
    const byIdx = new Map<number, LlmMessage>([
      [8, makeMsg(8, {
        wxid: 'team@chatroom',
        display: '项目群',
        isGroup: true,
        sender: 'them',
        senderDisplay: '张三',
        text: '麻烦整理节前遗留问题',
      })],
    ]);
    const out = enrichTodos(
      [{
        text: '整理节前遗留问题',
        source: 'other',
        sourceMsgId: 8,
        byWhenText: null,
        confidence: 'high',
      }],
      byIdx,
    );

    expect(out[0].sourceSenderDisplay).toBe('张三');
  });
});

describe('buildAiPromptContext', () => {
  it('does not expose raw wxid/openim/chatroom ids to the model prompt', () => {
    const cropped = cropSnapshotForLlm({
      sessions: [],
      messages: [{
        wxid: '45434442516@chatroom',
        display: '45434442516 客户群',
        isGroup: true,
        ts: 1_700_000_000,
        sender: 'them',
        type: 1,
        content: '25984985930267888@openim: 5.6语文作业',
      }],
      sessionsScanned: 1,
      messagesScanned: 1,
      totalReadableMessages: 1,
      selectedReadableMessages: 1,
      messagesTruncated: false,
      scanScope: 'test',
      safetyLimit: 10,
    });
    const context = buildAiPromptContext(cropped.messages);

    expect(context.prompt).toContain('source=chat_1');
    expect(context.prompt).toContain('客户群');
    expect(context.prompt).not.toContain('45434442516');
    expect(context.prompt).not.toContain('25984985930267888@openim');
    expect(context.sourcesByKey.get('chat_1')?.wxid).toBe('45434442516@chatroom');
  });

  it('uses group sender display in prompt when available', () => {
    const context = buildAiPromptContext([
      makeMsg(1, {
        wxid: 'team@chatroom',
        display: '项目群',
        isGroup: true,
        sender: 'them',
        senderDisplay: '张三',
        text: '麻烦整理节前遗留问题',
      }),
    ]);

    expect(context.prompt).toContain('张三: 麻烦整理节前遗留问题');
  });
});
