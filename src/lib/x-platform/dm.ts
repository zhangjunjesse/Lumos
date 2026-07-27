// X 私信读取(只读):收件箱对话列表 + 单会话消息记录。
// 复用 ensureScraper() 单例(带 cookie)和 getAuthStatus().userId(区分"对方"与"我")。
// 隐私:私信正文只在响应里返回给本地 UI 和本机 AI 会话(x_dm_* MCP 工具,用户显式放开),
// 不落库、不外发、不进日志明文。

import type { DmInbox, DmConversationTimeline } from '@the-convocation/twitter-scraper';
import { ensureScraper } from './scraper';
import { getAuthStatus } from './auth';
import { readXChatConversation, readXChatInbox } from './xchat-browser';

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
  /** 数据来源:legacy=老 /1.1/dm API;xchat-browser=浏览器读 XChat 新版加密私信 */
  source: 'legacy' | 'xchat-browser';
  /** 读取受限时给 AI/用户的明确说明(锁屏、未登录、需人工等) */
  notice?: string;
}

export interface DmConversationView {
  messages: DmMessageView[];      // 时间升序(老→新)
  status: 'AT_END' | 'HAS_MORE';
  minEntryId: string;             // 往更早翻页的游标(传给 maxId)
  peer: DmPeer | null;
  source: 'legacy' | 'xchat-browser';
  notice?: string;
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
  // 已迁移到 XChat 的账号调老 DM API 常见 403/404。过去没有 try/catch,异常直接 500,
  // 整条 XChat 兜底链路根本走不到 —— 表现就是「inbox 永远为空」(#48)。
  let inbox: Awaited<ReturnType<typeof scraper.getDmInbox>>;
  try {
    inbox = await scraper.getDmInbox();
  } catch (e) {
    console.warn('[x-dm] 老 DM API 取收件箱失败,转 XChat 浏览器兜底:', e instanceof Error ? e.message : e);
    return await inboxFromXChat(myUserId);
  }

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
  if (conversations.length > 0) {
    return { conversations, myUserId, source: 'legacy' };
  }
  // 老 API 空 —— 多半是账号已迁移到 XChat(端到端加密,/i/chat)。走浏览器兜底。
  return await inboxFromXChat(myUserId);
}

async function inboxFromXChat(myUserId: string): Promise<DmInboxView> {
  const res = await readXChatInbox();
  if (!res.ok || !res.data) {
    return {
      conversations: [],
      myUserId,
      source: 'legacy',
      notice: `私信收件箱为空:老接口无数据,浏览器读取 XChat 也未成功(${res.error ?? '未知原因'})。`,
    };
  }
  if (res.data.status !== 'ok') {
    const base = xchatStatusNotice(res.data.status);
    return {
      conversations: [], myUserId, source: 'xchat-browser',
      notice: res.debugFile ? `${base} 现场 DOM 已存到 ${res.debugFile}。` : base,
    };
  }
  const conversations: DmConversationSummary[] = res.data.items.map((it) => ({
    conversationId: it.conversationId,
    peer: it.name ? { userId: '', name: it.name, screenName: '', avatar: '' } : null,
    participantCount: 2,
    lastText: it.preview,
    lastTime: '0',
    lastFromMe: false,
    trusted: true,
  }));
  return {
    conversations,
    myUserId,
    source: 'xchat-browser',
    notice: '来自 XChat(X 新版加密私信),经浏览器读取;时间/已读等元数据有限。',
  };
}

function xchatStatusNotice(status: 'locked' | 'needs_login' | 'empty'): string {
  if (status === 'locked') return 'XChat 已被密码锁定:请先在 X 浏览器里输入 XChat 4 位密码解锁,再重试。';
  // 用户常会说「我明明登录了」——他看的是自己那个页面,而读私信用的是后台自动化上下文,
  // 两者登录态可以不一致(#48:屏幕上看得见会话,后台页却停在登录墙)。文案要点破这一点。
  if (status === 'needs_login') {
    return '读私信用的后台浏览器上下文未登录(你自己开着的页面可能是登录的,两者不共享)。'
      + '请到 Lumos「服务 → X」重新登录后重试;已识别为登录页,不会把界面文案当成私信返回。';
  }
  return 'XChat 页面未读到会话(可能未渲染完成或确实没有会话)。';
}

/** 单会话消息(时间升序);maxId 往更早翻页。 */
export async function getDmConversationView(
  conversationId: string,
  cursor?: { maxId?: string; minId?: string },
): Promise<DmConversationView> {
  const myUserId = (await getAuthStatus()).userId;
  const scraper = await ensureScraper();
  // 同 inbox:迁移账号调老 API 常见 403/404,过去异常直接 500 吃掉 XChat 兜底(#48)
  let timeline: DmConversationTimeline;
  try {
    timeline = await scraper.getDmConversation(conversationId, cursor);
  } catch (e) {
    console.warn('[x-dm] 老 DM API 取会话失败,转 XChat 浏览器兜底:', e instanceof Error ? e.message : e);
    return await conversationFromXChat(conversationId, null);
  }

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
  const peer = peerId ? toPeer(timeline.users, peerId) : null;

  if (messages.length > 0) {
    return { messages, status: timeline.status, minEntryId: timeline.min_entry_id || '', peer, source: 'legacy' };
  }
  // 老 API 有会话元数据却零消息 —— XChat 迁移的典型特征。走浏览器兜底读正文。
  return await conversationFromXChat(conversationId, peer);
}

async function conversationFromXChat(
  conversationId: string,
  peer: DmPeer | null,
): Promise<DmConversationView> {
  const res = await readXChatConversation(conversationId);
  if (!res.ok || !res.data) {
    return {
      messages: [], status: 'AT_END', minEntryId: '', peer, source: 'legacy',
      notice: `此会话老接口零消息,浏览器读取 XChat 也未成功(${res.error ?? '未知原因'})。`,
    };
  }
  if (res.data.status !== 'ok') {
    return { messages: [], status: 'AT_END', minEntryId: '', peer, source: 'xchat-browser', notice: xchatStatusNotice(res.data.status) };
  }
  const structured = res.data.messages.length > 0;
  const source = structured ? res.data.messages : res.data.rawLines.map((text) => ({ text, outgoing: null }));
  const messages: DmMessageView[] = source.map((m, i) => ({
    id: `xchat-${i}`,
    text: m.text,
    time: '0',
    fromMe: m.outgoing === true,
    senderId: m.outgoing === true ? 'me' : '',
  }));
  const notice = structured
    ? '来自 XChat(X 新版加密私信),经浏览器读取;发送方/时间判定可能不准。'
    : `来自 XChat,精确结构未识别、已回退整段文本(可能含界面噪音)。${res.debugFile ? `现场 DOM 已存到 ${res.debugFile},把该文件发给开发者可精确修正解析。` : ''}`;
  return { messages, status: 'AT_END', minEntryId: '', peer, source: 'xchat-browser', notice };
}
