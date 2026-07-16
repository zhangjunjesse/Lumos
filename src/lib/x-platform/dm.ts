// X 私信读取(只读):收件箱对话列表 + 单会话消息记录。
// 复用 ensureScraper() 单例(带 cookie)和 getAuthStatus().userId(区分"对方"与"我")。
// 隐私:私信正文只在响应里返回给本地 UI,不落库、不外发、不进日志明文。

import type { DmInbox, DmConversationTimeline } from '@the-convocation/twitter-scraper';
import { ensureScraper } from './scraper';
import { getAuthStatus } from './auth';

export interface DmPeer {
  userId: string;
  name: string;
  screenName: string;
  avatar: string;
}

export interface DmConversationSummary {
  conversationId: string;
  peer: DmPeer | null;      // 群聊或对方不在 users 表时为 null
  participantCount: number;
  lastText: string;
  lastTime: string;         // 毫秒时间戳字符串(X 原样)
  lastFromMe: boolean;
  trusted: boolean;
}

export interface DmMessageView {
  id: string;
  text: string;
  time: string;
  fromMe: boolean;
  senderId: string;
}

export interface DmInboxView {
  conversations: DmConversationSummary[];
  myUserId: string;
}

export interface DmConversationView {
  messages: DmMessageView[];      // 时间升序(老→新)
  status: 'AT_END' | 'HAS_MORE';
  minEntryId: string;             // 往更早翻页的游标(传给 maxId)
  peer: DmPeer | null;
}

type UserMap = DmInbox['users'];

function toPeer(users: UserMap, userId: string): DmPeer | null {
  const u = users?.[userId];
  if (!u) return null;
  return {
    userId,
    name: u.name || u.screen_name || userId,
    screenName: u.screen_name || '',
    avatar: u.profile_image_url_https || '',
  };
}

/** 收件箱 → 对话列表(按最近活动降序)。 */
export async function getDmInboxView(): Promise<DmInboxView> {
  const myUserId = (await getAuthStatus()).userId;
  const scraper = await ensureScraper();
  const inbox = await scraper.getDmInbox();

  // entries 是所有会话混在一起的消息;按会话取最新一条做预览。
  const latestByConv = new Map<string, { text: string; time: string; senderId: string }>();
  for (const entry of inbox.entries ?? []) {
    const m = entry.message;
    if (!m?.message_data) continue;
    const convId = m.conversation_id;
    const prev = latestByConv.get(convId);
    if (!prev || Number(m.message_data.time) > Number(prev.time)) {
      latestByConv.set(convId, {
        text: m.message_data.text || '',
        time: m.message_data.time || m.time || '0',
        senderId: m.message_data.sender_id || '',
      });
    }
  }

  const conversations: DmConversationSummary[] = Object.values(inbox.conversations ?? {}).map((conv) => {
    const peerId = conv.participants?.find((p) => p.user_id !== myUserId)?.user_id || '';
    const last = latestByConv.get(conv.conversation_id);
    return {
      conversationId: conv.conversation_id,
      peer: peerId ? toPeer(inbox.users, peerId) : null,
      participantCount: conv.participants?.length ?? 0,
      lastText: last?.text ?? '',
      lastTime: last?.time ?? conv.sort_timestamp ?? '0',
      lastFromMe: last ? last.senderId === myUserId : false,
      trusted: conv.trusted ?? true,
    };
  });

  conversations.sort((a, b) => Number(b.lastTime) - Number(a.lastTime));
  return { conversations, myUserId };
}

/** 单会话消息(时间升序);maxId 往更早翻页。 */
export async function getDmConversationView(
  conversationId: string,
  cursor?: { maxId?: string; minId?: string },
): Promise<DmConversationView> {
  const myUserId = (await getAuthStatus()).userId;
  const scraper = await ensureScraper();
  const timeline: DmConversationTimeline = await scraper.getDmConversation(conversationId, cursor);

  const messages: DmMessageView[] = (timeline.entries ?? [])
    .map((entry) => entry.message)
    .filter((m): m is NonNullable<typeof m> => Boolean(m?.message_data))
    .map((m) => ({
      id: m.id,
      text: m.message_data.text || '',
      time: m.message_data.time || m.time || '0',
      fromMe: m.message_data.sender_id === myUserId,
      senderId: m.message_data.sender_id || '',
    }))
    .sort((a, b) => Number(a.time) - Number(b.time));

  const conv = timeline.conversations?.[conversationId];
  const peerId = conv?.participants?.find((p) => p.user_id !== myUserId)?.user_id || '';
  return {
    messages,
    status: timeline.status,
    minEntryId: timeline.min_entry_id || '',
    peer: peerId ? toPeer(timeline.users, peerId) : null,
  };
}
