import { displayWechatName, isLikelyGroupId, safeSanitizedWechatText } from './display-helpers';
import type { Person, SuggestedFollowup } from './relations-types';

export interface SuggestedFollowupSourceContext {
  conversationName: string;
  conversationKind: '群聊' | '私聊';
  speakerName: string;
  evidenceText: string;
}

export function buildSuggestedFollowupSourceContext(
  item: SuggestedFollowup,
  peopleById: Map<string, Person>,
): SuggestedFollowupSourceContext {
  const primaryId = item.sourceWxid ?? item.involvedPersonIds[0] ?? null;
  const matched = primaryId ? peopleById.get(primaryId) ?? null : null;
  const isGroup = matched?.isGroup ?? isLikelyGroupId(primaryId);
  const sourceName = matched?.name ?? item.sourceDisplay ?? null;
  const conversationName = displayWechatName(sourceName, primaryId, {
    groupFallback: '微信群聊',
    contactFallback: '微信联系人',
  });

  return {
    conversationName,
    conversationKind: isGroup ? '群聊' : '私聊',
    speakerName: speakerName(item, isGroup),
    evidenceText: safeSanitizedWechatText(item.evidenceText, '暂无原文'),
  };
}

function speakerName(item: SuggestedFollowup, isGroup: boolean): string {
  if (item.sourceSpeaker === 'me') return '我';
  if (!isGroup) return '对方';
  return item.sourceSpeakerName
    ? displayWechatName(item.sourceSpeakerName, null, { contactFallback: '群成员' })
    : '群成员';
}
