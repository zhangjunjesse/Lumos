/**
 * WeChat Provider — Slash Commands
 *
 * 用户在微信「ClawBot」对话框里发命令操控 lumos session 路由。
 *
 *   /list [page]         列出 lumos 普通 chat session（按最近活跃，每页 10）
 *   /switch <编号|名字>  切换当前路由目标
 *   /current             显示当前路由到哪个 session
 *   /new [名字]          新建 session 并设为路由目标
 *   /voice on|off|status 切换当前微信对话的 AI 回复模式
 *   /help                显示命令清单（含上面 + builtin /ping /whoami）
 *
 * 入站消息以 / 开头时由 command-router 拦截，进 handleWechatCommand。
 * 命令的回复**不加** session 名前缀（用户输入命令时不希望前缀干扰）。
 */

import { getAllSessions, getSession, createSession } from '@/lib/db';
import type { ChatSession } from '@/types';
import type { IMCommandContext, IMCommandResult, InboundMessage } from '../../core/types';
import { handleBuiltinCommand } from '../../core/built-in-commands';
import { isMainAgentSession } from '@/lib/chat/session-entry';
import { WECHAT_COMMANDS } from './command-defs';
import {
  getCurrentRoutedSessionId,
  setCurrentRoutedSessionId,
} from './route-pointer';
import { isWechatVoiceModeEnabled, setWechatVoiceMode } from './voice-mode';

// Re-export so existing callers (tests, dispatcher) see WECHAT_COMMANDS from this module too.
export { WECHAT_COMMANDS };

const PAGE_SIZE = 10;
const ACTIVE_DAYS = 30;

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
    case 'voice':
    case '语音':
      return handleVoice(ctx);
  }

  // 内置命令兜底
  const builtin = await handleBuiltinCommand(ctx, '微信', WECHAT_COMMANDS);
  if (builtin) return builtin;
  return { handled: false };
}

export function maybeHandleWechatVoiceModePhrase(message: InboundMessage): IMCommandResult | null {
  const normalized = normalizeVoiceModePhrase(message.text);
  if (!normalized) return null;
  const peer = message.address.chatId;

  if (NATURAL_VOICE_ON_PHRASES.has(normalized)) {
    setWechatVoiceMode(peer, true);
    return replyForAddress(message, [
      '✓ 已切到语音模式。',
      '之后 AI 会优先发语音；你随时发语音，Lumos 都会先识别后再处理。',
      '退出：说“关闭语音模式”或发送 /voice off',
    ].join('\n'));
  }

  if (NATURAL_VOICE_OFF_PHRASES.has(normalized)) {
    setWechatVoiceMode(peer, false);
    return replyForAddress(message, '✓ 已切到文本模式。你发送的语音仍会被识别。');
  }

  if (NATURAL_VOICE_STATUS_PHRASES.has(normalized)) {
    const enabled = isWechatVoiceModeEnabled(peer);
    return replyForAddress(message, enabled
      ? '当前是语音模式。退出：说“关闭语音模式”或发送 /voice off'
      : '当前是文本模式。开启：说“开启语音模式”或发送 /voice on');
  }

  return null;
}

// ---- helpers ---------------------------------------------------------------

// 这些 marker 标记的是 lumos 内部专项会话（工作流编辑器、应用开发助手、知识库
// 助手）— 微信切换不应该把人带到这些非主线的对话里。`mode='workflow'` 是工作
// 流执行时自动建的临时调试 session，更不应该让用户切过去。
const SPECIAL_SESSION_MARKERS = [
  '__LUMOS_WORKFLOW_CHAT__',
  '__LUMOS_APP_BUILDER_CHAT__',
  '__LUMOS_LIBRARY_CHAT__',
];

function isSwitchableSession(s: ChatSession): boolean {
  if (s.status !== 'active') return false;
  if (s.mode === 'workflow') return false;
  const sp = String(s.system_prompt || '');
  for (const marker of SPECIAL_SESSION_MARKERS) {
    if (sp.includes(marker)) return false;
  }
  return true;
}

function listChatSessions(): ChatSession[] {
  const cutoff = Date.now() - ACTIVE_DAYS * 24 * 60 * 60 * 1000;
  return getAllSessions().filter((s) => {
    if (!isSwitchableSession(s)) return false;
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

/**
 * 给 /list 用的 session "归属"标签：
 *   - 主 agent → 「主 agent」
 *   - 有项目目录 → 「项目: <尾部目录名>」
 *   - 都没有 → 「自由对话」
 */
function sessionScopeLabel(session: ChatSession): string {
  if (isMainAgentSession(session)) return '主 agent';
  const wd = (session.working_directory || '').trim();
  if (wd) {
    const tail = wd.replace(/\/+$/, '').split('/').pop() || wd;
    return `项目: ${tail}`;
  }
  return '自由对话';
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
    const marker = isCurrent ? '  ← 当前' : '';
    const time = formatActiveTime(s.updated_at);
    const scope = sessionScopeLabel(s);
    lines.push(`${idx}. ${displayTitle(s)}${marker}`);
    lines.push(`   ${scope} · ${time}`.trimEnd());
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

// ---- /voice ----------------------------------------------------------------

function handleVoice(ctx: IMCommandContext): IMCommandResult {
  const arg = (ctx.args[0] || 'status').trim().toLowerCase();
  const peer = ctx.message.address.chatId;

  if (isOnArg(arg)) {
    setWechatVoiceMode(peer, true);
    return reply(ctx, [
      '✓ 已切到语音模式。',
      '之后 AI 会优先发语音；你随时发语音，Lumos 都会先识别后再处理。',
      '退出：/voice off',
    ].join('\n'));
  }

  if (isOffArg(arg)) {
    setWechatVoiceMode(peer, false);
    return reply(ctx, '✓ 已切到文本模式。你发送的语音仍会被识别。');
  }

  if (arg === 'status' || arg === '状态' || arg === '当前') {
    const enabled = isWechatVoiceModeEnabled(peer);
    return reply(ctx, enabled
      ? '当前是语音模式。退出：/voice off'
      : '当前是文本模式。开启：/voice on');
  }

  return reply(ctx, '用法：/voice on 开启语音回复；/voice off 切回文本；/voice status 查看状态。');
}

function isOnArg(arg: string): boolean {
  return ['on', '1', 'true', 'yes', 'y', 'enable', 'enabled', 'open', 'voice', '语音', '开', '开启', '打开'].includes(arg);
}

function isOffArg(arg: string): boolean {
  return ['off', '0', 'false', 'no', 'n', 'disable', 'disabled', 'close', 'text', '文本', '关', '关闭'].includes(arg);
}

const NATURAL_VOICE_ON_PHRASES = new Set([
  '开启语音模式',
  '打开语音模式',
  '进入语音模式',
  '切到语音模式',
  '切换到语音模式',
  '用语音回复',
  '以后用语音回复',
  '后面用语音回复',
  '语音回复',
]);

const NATURAL_VOICE_OFF_PHRASES = new Set([
  '关闭语音模式',
  '退出语音模式',
  '关掉语音模式',
  '切回文本模式',
  '切到文本模式',
  '切换到文本模式',
  '用文字回复',
  '用文本回复',
  '以后用文字回复',
  '以后用文本回复',
  '文本回复',
]);

const NATURAL_VOICE_STATUS_PHRASES = new Set([
  '语音模式状态',
  '当前语音模式',
  '现在是什么模式',
  '当前是什么模式',
]);

function normalizeVoiceModePhrase(text: string): string {
  return (text || '')
    .trim()
    .replace(/[\s,，.。!！?？:：;；"'“”‘’`~～、]/g, '');
}

// ---- shared ----------------------------------------------------------------

function reply(ctx: IMCommandContext, text: string): IMCommandResult {
  return {
    handled: true,
    reply: { address: ctx.message.address, text },
  };
}

function replyForAddress(message: InboundMessage, text: string): IMCommandResult {
  return {
    handled: true,
    reply: { address: message.address, text },
  };
}
