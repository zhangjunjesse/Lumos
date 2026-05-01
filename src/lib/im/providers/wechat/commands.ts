/**
 * WeChat Provider — Slash Commands
 *
 * 用户在微信「ClawBot」对话框里发命令操控 lumos session 路由。
 *
 *   /list [page]         列出 lumos 普通 chat session（按最近活跃，每页 10）
 *   /switch <编号|名字>  切换当前路由目标
 *   /current             显示当前路由到哪个 session
 *   /new [名字]          新建 session 并设为路由目标
 *   /help                显示命令清单（含上面 + builtin /ping /whoami）
 *
 * 入站消息以 / 开头时由 command-router 拦截，进 handleWechatCommand。
 * 命令的回复**不加** session 名前缀（用户输入命令时不希望前缀干扰）。
 */

import { getAllSessions, getSession, createSession } from '@/lib/db';
import type { ChatSession } from '@/types';
import type { IMCommand, IMCommandContext, IMCommandResult } from '../../core/types';
import { handleBuiltinCommand, BUILTIN_COMMANDS } from '../../core/built-in-commands';
import {
  getCurrentRoutedSessionId,
  setCurrentRoutedSessionId,
} from './route-pointer';

const PAGE_SIZE = 10;
const ACTIVE_DAYS = 30;

export const WECHAT_COMMANDS: IMCommand[] = [
  ...BUILTIN_COMMANDS,
  { name: 'list', description: '列出 lumos 会话（/list <页码>）' },
  { name: 'switch', description: '切换当前会话（/switch <编号|名字>）' },
  { name: 'current', description: '查看当前路由到哪个会话' },
  { name: 'new', description: '新建会话并设为路由目标（/new <名字>）' },
];

export async function handleWechatCommand(
  ctx: IMCommandContext,
): Promise<IMCommandResult> {
  const cmd = ctx.command.toLowerCase();

  // 自定义命令优先
  switch (cmd) {
    case 'list':
      return handleList(ctx);
    case 'switch':
      return handleSwitch(ctx);
    case 'current':
      return handleCurrent(ctx);
    case 'new':
      return handleNew(ctx);
  }

  // 内置命令兜底
  const builtin = await handleBuiltinCommand(ctx, '微信', WECHAT_COMMANDS);
  if (builtin) return builtin;
  return { handled: false };
}

// ---- helpers ---------------------------------------------------------------

function listChatSessions(): ChatSession[] {
  const cutoff = Date.now() - ACTIVE_DAYS * 24 * 60 * 60 * 1000;
  return getAllSessions().filter((s) => {
    // chat_sessions.status: 'active' | 'archived' — 已删除的行被 deleteSession 物理删，
    // 这里不需要再过滤 'deleted'。但归档的也不参与微信切换。
    if (s.status !== 'active') return false;
    const ts = parseUpdatedAt(s.updated_at);
    return ts >= cutoff;
  });
}

function parseUpdatedAt(s: string | undefined): number {
  if (!s) return 0;
  const t = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : 0;
}

function displayTitle(session: ChatSession): string {
  const t = (session.title || '').trim();
  if (t && t !== 'New Chat') return t;
  return `(未命名 ${session.id.slice(0, 6)})`;
}

function shortId(session: ChatSession): string {
  return session.id.slice(0, 6);
}

function formatActiveTime(s: string | undefined): string {
  const t = parseUpdatedAt(s);
  if (!t) return '';
  const diff = Date.now() - t;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) {
    const d = new Date(t);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (diff < 2 * day) return '昨天';
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return `${Math.floor(diff / day)} 天前`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

// ---- /list -----------------------------------------------------------------

function handleList(ctx: IMCommandContext): IMCommandResult {
  const sessions = listChatSessions();
  const total = sessions.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  let page = parseInt(ctx.args[0] || '1', 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (page > totalPages) page = totalPages;

  const start = (page - 1) * PAGE_SIZE;
  const slice = sessions.slice(start, start + PAGE_SIZE);
  const currentId = getCurrentRoutedSessionId();

  if (slice.length === 0) {
    return reply(ctx, '📋 没有最近 30 天活跃过的会话。\n\n用 /new 新建一个。');
  }

  const lines = [`📋 lumos 会话 (第 ${page} 页 / 共 ${totalPages} 页)`, ''];
  slice.forEach((s, i) => {
    const idx = start + i + 1;
    const isCurrent = s.id === currentId;
    const marker = isCurrent ? '← 当前' : '';
    const time = formatActiveTime(s.updated_at);
    lines.push(`${idx}. ${displayTitle(s)} · ${time} ${marker}`.trim());
  });
  lines.push('');
  lines.push('回复 /switch <编号|名字> 切换；/new 新建');

  return reply(ctx, lines.join('\n'));
}

// ---- /switch ---------------------------------------------------------------

function handleSwitch(ctx: IMCommandContext): IMCommandResult {
  const arg = ctx.args.join(' ').trim();
  if (!arg) {
    return reply(ctx, '用法：/switch <编号|名字|短ID>\n先用 /list 看列表');
  }

  const sessions = listChatSessions();
  if (sessions.length === 0) {
    return reply(ctx, '没有可切换的会话。用 /new 新建一个。');
  }

  // 编号
  const idx = parseInt(arg, 10);
  if (Number.isFinite(idx) && idx >= 1 && idx <= sessions.length) {
    const s = sessions[idx - 1];
    setCurrentRoutedSessionId(s.id);
    return reply(ctx, `✓ 已切到 #${idx} ${displayTitle(s)}`);
  }

  // 短 ID 精确
  const byShortId = sessions.filter((s) => shortId(s) === arg.toLowerCase());
  if (byShortId.length === 1) {
    setCurrentRoutedSessionId(byShortId[0].id);
    return reply(ctx, `✓ 已切到 ${displayTitle(byShortId[0])}`);
  }

  // 名字精确
  const byExact = sessions.filter((s) => displayTitle(s) === arg);
  if (byExact.length === 1) {
    setCurrentRoutedSessionId(byExact[0].id);
    return reply(ctx, `✓ 已切到 ${displayTitle(byExact[0])}`);
  }

  // 名字模糊
  const lower = arg.toLowerCase();
  const byFuzzy = sessions.filter((s) =>
    displayTitle(s).toLowerCase().includes(lower),
  );
  if (byFuzzy.length === 1) {
    setCurrentRoutedSessionId(byFuzzy[0].id);
    return reply(ctx, `✓ 已切到 ${displayTitle(byFuzzy[0])}`);
  }
  if (byFuzzy.length > 1) {
    const lines = ['找到多个匹配，请用编号或短 ID：', ''];
    byFuzzy.slice(0, 5).forEach((s) => {
      lines.push(`• ${displayTitle(s)} (${shortId(s)})`);
    });
    return reply(ctx, lines.join('\n'));
  }

  return reply(ctx, `没找到匹配 "${arg}" 的会话。/list 看完整列表。`);
}

// ---- /current --------------------------------------------------------------

function handleCurrent(ctx: IMCommandContext): IMCommandResult {
  const id = getCurrentRoutedSessionId();
  if (!id) {
    return reply(ctx, '当前没有路由目标。下条消息会自动建一个新会话。');
  }
  const s = getSession(id);
  if (!s) {
    return reply(ctx, '当前路由目标已不存在。下条消息会自动建一个新会话。');
  }
  return reply(ctx, `📂 当前: ${displayTitle(s)} (${shortId(s)})`);
}

// ---- /new ------------------------------------------------------------------

function handleNew(ctx: IMCommandContext): IMCommandResult {
  const titleArg = ctx.args.join(' ').trim();
  const session = createSession(titleArg || undefined);
  setCurrentRoutedSessionId(session.id);
  const label = titleArg ? `📂 ${titleArg}` : `📂 新会话 (${shortId(session)})`;
  return reply(ctx, `✓ 已新建并切到\n${label}`);
}

// ---- shared ----------------------------------------------------------------

function reply(ctx: IMCommandContext, text: string): IMCommandResult {
  return {
    handled: true,
    reply: { address: ctx.message.address, text },
  };
}
