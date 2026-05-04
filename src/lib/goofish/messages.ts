/**
 * Conversation list + message history queries against the goofish CLI.
 *
 * Split out from cli.ts to keep that file under the project's 300-line cap.
 * Reuses the low-level `runJsonCommand` runner and `normalizeNick` decoder
 * from cli.ts — those stay in cli.ts because auth.ts equivalents would also
 * need them and a 3-way split is overkill.
 */

import { runJsonCommand, normalizeNick } from './cli';
import { fetchFatHistory, fetchFatChats } from './fat-history';

export interface GoofishChatSession {
  session_id: string;
  peer_nick: string;
  peer_user_id: string;
  peer_avatar: string;
  unread: number;
  last_msg: string;
  ts: number;
  session_type: number;
  item_id: string;
  item_title: string;
  item_main_pic: string;
  /** "baseline" = HTTP session.sync, "watch" = ACCS WS push补充. */
  source: 'baseline' | 'watch' | '';
}

export interface GoofishChatList {
  sessions: GoofishChatSession[];
  readReceipts: Record<string, string[]>;
  watchFell: boolean;
}

/**
 * Top-level entry point used by the UI. Pulls the chats_fat.py sidecar
 * which combines HTTP baseline + WS push extraction, returning peer info,
 * item info, avatars, and read receipts in one shot.
 *
 * For WS-only sessions where the push didn't carry peer info, we still
 * enrich via getMessageHistory (parallel, capped concurrency).
 *
 * `myUnb` is required to label peer correctly during fallback enrichment.
 */
export async function listChatsEnriched(
  fetchNum: number,
  watchSecs: number,
  myUnb: string,
): Promise<GoofishChatList> {
  let watchFell = false;
  let fat;
  try {
    fat = await fetchFatChats(fetchNum, watchSecs);
  } catch {
    // WS leg failed — retry baseline only so user sees something.
    fat = await fetchFatChats(fetchNum, 0);
    watchFell = true;
  }
  const sessions = fat.sessions as GoofishChatSession[];

  // Enrich any session that still lacks peer info (WS-only skeletons).
  const skeletons = sessions.filter((s) => !s.peer_nick && !s.last_msg);
  if (skeletons.length > 0 && myUnb) {
    const enriched = await runWithConcurrency(skeletons, 5, (s) => enrichSkeleton(s, myUnb));
    const byId = new Map(enriched.map((s) => [s.session_id, s]));
    for (let i = 0; i < sessions.length; i++) {
      const fresh = byId.get(sessions[i].session_id);
      if (fresh) sessions[i] = fresh;
    }
  }
  return { sessions, readReceipts: fat.read_receipts, watchFell };
}

async function enrichSkeleton(session: GoofishChatSession, myUnb: string): Promise<GoofishChatSession> {
  // 30 instead of 10: some buried conversations have a tail of system pushes
  // ("请及时确认收货" / "快给ta一个评价吧～") in front of the actual chat —
  // need to look further to find the real text exchange and peer nick.
  const msgs = await getMessageHistory(session.session_id, 30).catch(() => [] as GoofishMessage[]);
  if (msgs.length === 0) return session;

  // Find the peer the right way: skip system pushes (contentType ∈ {6,14}).
  // 闲鱼 wraps notifications like "请及时确认收货" / "快给ta一个评价吧" inside
  // messages where send_user_name is the push TITLE (not a real nick) — never
  // use that as the peer label.
  const isReal = (m: GoofishMessage) => m.content.kind === 'text' || m.content.kind === 'image' || m.content.kind === 'item';
  const realPeerMsg = msgs.find((m) => m.fromUserId && m.fromUserId !== myUnb && isReal(m));
  const realSelfMsg = msgs.find((m) => m.fromUserId === myUnb && isReal(m));

  const peerNick = realPeerMsg?.fromUserName || '';
  let peerId = realPeerMsg?.fromUserId || '';
  // One-way chats: I sent but no reply yet. Fall back to receiver uid only —
  // do NOT synthesize a "用户 12345" nick here. Leaving peer_nick empty lets
  // the cross-session backfill fill it from a sibling session that has the
  // real fishNick. Only the UI's last-mile fallback shows "用户 xxx".
  if (!peerId && realSelfMsg?.receiverUserId) {
    peerId = realSelfMsg.receiverUserId;
  }

  // Preview prefers a non-system message; if all we have are system pushes,
  // show the latest one's summary so the user at least sees what arrived.
  const realLatest = [...msgs].filter(isReal).sort((a, b) => b.createdAt - a.createdAt)[0];
  const newest = [...msgs].sort((a, b) => b.createdAt - a.createdAt)[0];
  const previewMsg = realLatest || newest;
  const preview = previewMsg ? (previewOf(previewMsg.content) || previewMsg.summary) : '';

  return {
    ...session,
    peer_nick: peerNick || session.peer_nick,
    peer_user_id: peerId || session.peer_user_id,
    last_msg: preview || session.last_msg,
    ts: newest?.createdAt || session.ts,
  };
}

function previewOf(c: GoofishMessageContent | undefined): string {
  if (!c) return '';
  if (c.kind === 'text') return c.text;
  if (c.kind === 'image') return '[图片]';
  if (c.kind === 'item') return `[商品] ${c.title}`;
  if (c.kind === 'system') return c.text;
  return '';
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}


export type GoofishMessageContent =
  | { kind: 'text'; text: string }
  | { kind: 'image'; url: string; width: number; height: number }
  | { kind: 'item'; itemId: string; price: string; title: string; mainPic: string; tip?: string }
  | { kind: 'system'; text: string }
  | { kind: 'unknown'; raw: string };

export interface GoofishMessage {
  /** Stable message ID, used to match against read-receipt push lists. */
  messageId: string;
  fromUserId: string;
  fromUserName: string;
  /** Recipient uid (the peer when I'm the sender). Empty otherwise. */
  receiverUserId: string;
  /** Millisecond unix timestamp; 0 if upstream didn't surface one. */
  createdAt: number;
  /** 0 = unknown, 1 = read by peer, 2 = unread. Only meaningful for self-sent messages. */
  readStatus: number;
  /** Plain-text summary the platform attaches; useful as a fallback preview. */
  summary: string;
  content: GoofishMessageContent;
}

/**
 * Pulls message history via our `history_fat.py` sidecar instead of the
 * upstream `goofish message history` command. The upstream CLI drops every
 * field except sender id / sender name / decoded payload — including the
 * millisecond `createAt` timestamp the WS protocol carries on every frame.
 * The sidecar reuses goofish-cli's auth + WS code, only replacing the
 * parsing step to keep all useful fields. See history_fat.py for details.
 *
 * Falls back to the upstream command if the Python sidecar can't be located
 * (no goofish bin shebang, missing python, etc.) — degraded mode loses
 * timestamps but keeps the chat usable.
 */
export async function getMessageHistory(cid: string, limitPerPage = 50, homeOverride?: string): Promise<GoofishMessage[]> {
  try {
    const arr = await fetchFatHistory(cid, limitPerPage, homeOverride);
    return arr.map((m) => ({
      messageId: String(m.message_id || ''),
      fromUserId: String(m.send_user_id || ''),
      fromUserName: normalizeNick(m.send_user_name || ''),
      receiverUserId: String(m.receiver_user_id || ''),
      createdAt: Number(m.created_at || 0),
      readStatus: Number(m.read_status || 0),
      summary: String(m.summary || ''),
      content: extractContent(m.message || {}),
    }));
  } catch {
    // Sidecar errors fall through to upstream so a transient WS hiccup
    // doesn't break the chat detail page entirely.
    const data = await runJsonCommand(
      ['message', 'history', cid, '--limit-per-page', String(limitPerPage)],
      { timeoutMs: 30_000 },
    );
    const arr = Array.isArray(data)
      ? data
      : Array.isArray((data as { messages?: unknown }).messages)
        ? (data as { messages: unknown[] }).messages
        : [];
    return arr.map((raw) => normalizeUpstreamMessage(raw as Record<string, unknown>));
  }
}

/**
 * Send a text message to a conversation. Wraps `goofish message send`.
 * Returns success status; the chat detail page should re-fetch messages
 * after a successful send to display the new entry.
 */
export async function sendMessage(cid: string, toid: string, text: string): Promise<void> {
  if (!cid || !toid || !text.trim()) {
    throw new Error('cid, toid, text are required');
  }
  // cid + toid are positional in goofish-cli's signature.
  await runJsonCommand(
    ['message', 'send', cid, toid, '--text', text],
    { timeoutMs: 30_000 },
  );
}

function normalizeUpstreamMessage(raw: Record<string, unknown>): GoofishMessage {
  const msg = (raw.message ?? {}) as Record<string, unknown>;
  return {
    messageId: '',
    fromUserId: String(raw.send_user_id ?? ''),
    fromUserName: normalizeNick(typeof raw.send_user_name === 'string' ? raw.send_user_name : ''),
    receiverUserId: '',
    createdAt: 0,
    readStatus: 0,
    summary: '',
    content: extractContent(msg),
  };
}

export function extractContent(msg: Record<string, unknown>): GoofishMessageContent {
  const ct = Number(msg.contentType ?? 0);
  if (ct === 1) {
    const t = (msg.text as { text?: string } | undefined)?.text ?? '';
    return { kind: 'text', text: t };
  }
  if (ct === 2) {
    const pic = (msg.image as { pics?: Array<{ url?: string; width?: number; height?: number }> } | undefined)?.pics?.[0];
    return { kind: 'image', url: pic?.url ?? '', width: pic?.width ?? 0, height: pic?.height ?? 0 };
  }
  if (ct === 7) {
    const it = (msg.itemCard as { item?: { itemId?: number | string; price?: string; title?: string; mainPic?: string }; itemTip?: string } | undefined);
    return {
      kind: 'item',
      itemId: String(it?.item?.itemId ?? ''),
      price: it?.item?.price ?? '',
      title: it?.item?.title ?? '',
      mainPic: it?.item?.mainPic ?? '',
      tip: it?.itemTip,
    };
  }
  if (ct === 6) {
    const html = (msg.textCard as { content?: string; title?: string } | undefined);
    const text = stripHtml((html?.title ?? '') + ' ' + (html?.content ?? ''));
    return { kind: 'system', text };
  }
  if (ct === 14) {
    const t = (msg.tip as { tip?: string } | undefined)?.tip ?? '';
    return { kind: 'system', text: t };
  }
  return { kind: 'unknown', raw: JSON.stringify(msg) };
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}


/**
 * Walk recent buyer chats until we find a message the user sent themselves,
 * and return the `send_user_name` from it — that's the user's current
 * (post-rename) display nickname. See nick-cache.ts for why this is needed.
 *
 * Returns empty string if no self-sent message found in the first few chats.
 */
export async function extractCurrentNick(unb: string, homeOverride?: string): Promise<string> {
  if (!unb) return '';
  const fat = await fetchFatChats(30, 0, homeOverride).catch(() => null);
  const candidates = (fat?.sessions ?? []).filter((s) => s.session_type === 1 && s.peer_user_id);
  for (const sess of candidates.slice(0, 5)) {
    const msgs = await getMessageHistory(sess.session_id, 50, homeOverride).catch(() => []);
    const self = msgs.find((m) => m.fromUserId === unb && m.fromUserName);
    if (self) return self.fromUserName;
  }
  return '';
}
