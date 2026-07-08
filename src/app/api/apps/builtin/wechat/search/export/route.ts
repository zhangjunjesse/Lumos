import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { listMessagesForExport } from '@/lib/wechat-assistant/mirror-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const scopeSchema = z.enum(['all', 'personal', 'group']).catch('all');
const senderSchema = z.enum(['me', 'them']).catch('me');

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const query = (params.get('q') ?? '').trim().slice(0, 120);
  const scope = scopeSchema.parse(params.get('scope') ?? 'all');
  const sender = senderSchema.parse(params.get('sender') ?? 'me');
  const { fromTs, toTs } = parseDateRange(params);

  const rows = listMessagesForExport({
    query,
    scope,
    sender,
    fromTs,
    toTs,
  });

  const csv = toCsv(rows);
  const filename = `wechat-${sender}-messages-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

function toCsv(rows: ReturnType<typeof listMessagesForExport>): string {
  const header = ['时间', '聊天对象', '聊天类型', '发送者', '消息类型', '内容'];
  const lines = rows.map((row) => [
    formatTime(row.ts),
    row.display,
    row.isGroup ? '群聊' : '私聊',
    row.sender === 'me' ? '我' : row.senderDisplay || (row.isGroup ? '群成员' : '对方'),
    String(row.msgType),
    row.content,
  ].map(csvCell).join(','));
  return `\uFEFF${header.map(csvCell).join(',')}\n${lines.join('\n')}\n`;
}

function csvCell(value: string): string {
  const text = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const safe = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false });
}

function parseDateRange(params: URLSearchParams): { fromTs: number | null; toTs: number | null } {
  return {
    fromTs: parseLocalDateStart(params.get('from')),
    toTs: parseLocalDateEndExclusive(params.get('to')),
  };
}

function parseLocalDateStart(value: string | null): number | null {
  const parts = parseDateParts(value);
  if (!parts) return null;
  return Math.floor(new Date(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0).getTime() / 1000);
}

function parseLocalDateEndExclusive(value: string | null): number | null {
  const parts = parseDateParts(value);
  if (!parts) return null;
  return Math.floor(new Date(parts.year, parts.month - 1, parts.day + 1, 0, 0, 0, 0).getTime() / 1000);
}

function parseDateParts(value: string | null): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}
