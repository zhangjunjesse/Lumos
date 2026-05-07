import type {
  WeChatSnapshot,
  WeChatSnapshotMessage,
  WeChatSnapshotSession,
} from './analysis';

export interface SnapshotApiResponse {
  sessions?: Array<WeChatSnapshotSession & { is_group?: boolean }>;
  messages?: Array<{
    wxid?: string;
    display?: string;
    is_group?: boolean;
    ts?: number;
    sender?: string;
    sender_wxid?: string;
    sender_display?: string;
    type?: number;
    content?: string;
  }>;
  sessions_scanned?: number;
  messages_scanned?: number;
  total_readable_messages?: number;
  selected_readable_messages?: number;
  messages_truncated?: boolean;
  scan_scope?: string;
  safety_limit?: number;
}

export function normalizeSnapshot(data: SnapshotApiResponse): WeChatSnapshot {
  const sessions: WeChatSnapshotSession[] = (data.sessions ?? []).map((s) => ({
    wxid: String(s.wxid ?? ''),
    display: String(s.display ?? s.wxid ?? '未知会话'),
    summary: s.summary,
    last_timestamp: s.last_timestamp,
    unread_count: s.unread_count,
    is_group: Boolean(s.is_group),
  })).filter((s) => s.wxid);

  const messages: WeChatSnapshotMessage[] = (data.messages ?? []).map((m): WeChatSnapshotMessage => ({
    wxid: String(m.wxid ?? ''),
    display: String(m.display ?? m.wxid ?? '未知会话'),
    isGroup: Boolean(m.is_group),
    ts: Number(m.ts ?? 0),
    sender: m.sender === 'me' ? 'me' : 'them',
    senderWxid: typeof m.sender_wxid === 'string' ? m.sender_wxid : null,
    senderDisplay: typeof m.sender_display === 'string' ? m.sender_display : null,
    type: Number(m.type ?? 0),
    content: String(m.content ?? ''),
  })).filter((m) => m.wxid && m.ts > 0 && m.content.trim());

  return {
    sessions,
    messages,
    sessionsScanned: Number(data.sessions_scanned ?? sessions.length),
    messagesScanned: Number(data.messages_scanned ?? messages.length),
    totalReadableMessages: Number(data.total_readable_messages ?? data.messages_scanned ?? messages.length),
    selectedReadableMessages: Number(data.selected_readable_messages ?? data.messages_scanned ?? messages.length),
    messagesTruncated: Boolean(data.messages_truncated),
    scanScope: String(data.scan_scope ?? 'all_readable_wechat_messages'),
    safetyLimit: Number(data.safety_limit ?? 50000),
  };
}
