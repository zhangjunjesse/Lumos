import { buildSuggestedFollowupSourceContext } from '../suggested-followup-source';
import type { Person, SuggestedFollowup } from '../relations-types';

describe('suggested followup source context', () => {
  it('shows readable group, speaker, and source message without internal ids', () => {
    const item: SuggestedFollowup = {
      id: 'todo-1',
      draftTitle: '整理节前遗留问题清单',
      draftType: 'reply',
      reason: '客户群里提到需要跟进',
      involvedPersonIds: ['45434442516'],
      evidenceText: '25984985930267888@openim: 整理节前遗留问题清单发到 45434442516 客户群',
      sourceDisplay: '45434442516 客户群',
      sourceWxid: '45434442516',
      sourceSpeaker: 'them',
      sourceSpeakerName: '25984985930267888@openim',
    };
    const people = new Map<string, Person>([
      ['45434442516', fakePerson({ id: '45434442516', name: '节前客户群', isGroup: true })],
    ]);

    const context = buildSuggestedFollowupSourceContext(item, people);

    expect(context).toEqual({
      conversationName: '节前客户群',
      conversationKind: '群聊',
      speakerName: '群成员',
      evidenceText: '整理节前遗留问题清单发到 客户群',
    });
    expect(JSON.stringify(context)).not.toMatch(/openim|45434442516|25984985930267888/);
  });

  it('falls back to clean contact labels instead of raw openim ids', () => {
    const item: SuggestedFollowup = {
      id: 'todo-2',
      draftTitle: '5.6语文作业',
      draftType: 'other',
      reason: '需要记录作业',
      involvedPersonIds: ['25984985930267888@openim'],
      evidenceText: '25984985930267888@openim: 5.6语文作业 订正默写本',
      sourceDisplay: '25984985930267888@openim',
      sourceWxid: '25984985930267888@openim',
      sourceSpeaker: 'them',
      sourceSpeakerName: '25984985930267888@openim',
    };

    const context = buildSuggestedFollowupSourceContext(item, new Map());

    expect(context).toEqual({
      conversationName: '微信联系人',
      conversationKind: '私聊',
      speakerName: '对方',
      evidenceText: '5.6语文作业 订正默写本',
    });
    expect(JSON.stringify(context)).not.toMatch(/openim|25984985930267888/);
  });
});

function fakePerson(input: { id: string; name: string; isGroup: boolean }): Person {
  return {
    id: input.id,
    wxid: input.id,
    name: input.name,
    isGroup: input.isGroup,
    groups: ['colleague'],
    totalMessages30d: 0,
    yourShare30d: 0,
    lastInteractionTs: 0,
    interactionDays: [],
    topWords: [],
    toneTags: [],
  };
}
