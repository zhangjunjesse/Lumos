import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  buildWeChatAssistantAnalysis,
  type WeChatSnapshot,
  type WeChatSnapshotMessage,
  type WeChatSnapshotSession,
} from '@/lib/wechat-assistant/analysis';
import { updateWeChatAssistantTask } from '@/lib/wechat-assistant/tasks';
import { queryWeChatApi } from '@/lib/wechat-export/api-bridge';
import { hasValidConsent } from '@/lib/wechat-export/disclaimer';
import { hasRecoveredKey } from '@/lib/wechat-export/setup-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  sessionLimit: z.number().int().min(1).max(1000).optional(),
  perSessionLimit: z.number().int().min(1).max(2000).optional(),
  maxMessages: z.number().int().min(100).max(200000).optional(),
});

interface SnapshotApiResponse {
  sessions?: Array<WeChatSnapshotSession & { is_group?: boolean }>;
  messages?: Array<{
    wxid?: string;
    display?: string;
    is_group?: boolean;
    ts?: number;
    sender?: string;
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

export async function POST(req: NextRequest) {
  if (process.platform !== 'darwin') {
    return NextResponse.json({ error: 'unsupported_platform' }, { status: 400 });
  }
  if (!hasValidConsent()) {
    return NextResponse.json({ error: 'consent_required' }, { status: 400 });
  }
  if (!hasRecoveredKey()) {
    return NextResponse.json({ error: 'no_key' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const snapshotResult = await queryWeChatApi<SnapshotApiResponse>('analyze_snapshot', {
    session_limit: parsed.data.sessionLimit ?? 0,
    per_session_limit: parsed.data.perSessionLimit ?? 0,
    max_messages: parsed.data.maxMessages ?? 50000,
  }, {
    timeoutMs: 120_000,
  });
  if (!snapshotResult.ok) {
    return NextResponse.json({
      error: snapshotResult.error.code,
      message: snapshotResult.error.message,
    }, { status: 500 });
  }

  const snapshot = normalizeSnapshot(snapshotResult.data);
  const analysis = buildWeChatAssistantAnalysis(snapshot);
  updateWeChatAssistantTask('daily-summary', {
    lastRunAt: analysis.generatedAt,
    lastResult: analysis.summary,
  });
  return NextResponse.json({ analysis });
}

function normalizeSnapshot(data: SnapshotApiResponse): WeChatSnapshot {
  const sessions: WeChatSnapshotSession[] = (data.sessions ?? []).map((session) => ({
    wxid: String(session.wxid ?? ''),
    display: String(session.display ?? session.wxid ?? '未知会话'),
    summary: session.summary,
    last_timestamp: session.last_timestamp,
    unread_count: session.unread_count,
    is_group: Boolean(session.is_group),
  })).filter((session) => session.wxid);

  const messages: WeChatSnapshotMessage[] = (data.messages ?? []).map((message): WeChatSnapshotMessage => ({
    wxid: String(message.wxid ?? ''),
    display: String(message.display ?? message.wxid ?? '未知会话'),
    isGroup: Boolean(message.is_group),
    ts: Number(message.ts ?? 0),
    sender: message.sender === 'me' ? 'me' : 'them',
    type: Number(message.type ?? 0),
    content: String(message.content ?? ''),
  })).filter((message) => message.wxid && message.ts > 0 && message.content.trim());

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
