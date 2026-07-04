import { createSession, getAllSessions, updateSessionStatus, getSetting, updateSessionBrowserContext } from '@/lib/db';
import { validateBrowserContextId } from '@/lib/browser-provider/context-validation';
import { isMainAgentSession } from './session-entry';
import { localDayKey, resolveTimezone } from '@/lib/memory-v2/day-window';
import type { ChatSession } from '@/types';

// 主 Agent 会话契约：一天一条。
// - 标题 = "本地睡眠日" YYYY-MM-DD。这里"日"按用户的 memory_v2_sleep_time 偏移：
//   sleep_time=03:30 时，凌晨 03:00 仍算昨天，04:00 才切到新一天。
//   这跟用户原话「睡眠时间后才自动起新会话」一致，也跟 memory-v2 sleep tick 同口径。
// - 归档 = chat_sessions.status='archived'，messages 行不动（避免丢史）。
// - 切日单点：resolveMainAgentSession({ createIfMissing }) 既负责"取今天"也负责归档+新建。

const DEFAULT_SLEEP_TIME = '03:30';

function userTimezone(): string {
  return resolveTimezone(getSetting('memory_v2_sleep_timezone'));
}

function userSleepShiftMinutes(): number {
  const raw = (getSetting('memory_v2_sleep_time') || DEFAULT_SLEEP_TIME).trim();
  const match = raw.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) {
    const [dh, dm] = DEFAULT_SLEEP_TIME.split(':').map(Number);
    return dh * 60 + dm;
  }
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));
  return hour * 60 + minute;
}

// "睡眠日" = 本地时刻减去 sleep_time 偏移后所在的自然日。
// at 一律按 UTC 解析，偏移和时区由调用方负责。
function shiftedDayKey(at: Date): string {
  const shifted = new Date(at.getTime() - userSleepShiftMinutes() * 60 * 1000);
  return localDayKey(shifted, userTimezone());
}

export function currentMainAgentDayKey(now = new Date()): string {
  return shiftedDayKey(now);
}

// chat_sessions.created_at 是 UTC SQL ('YYYY-MM-DD HH:MM:SS')。
// 显式补 'Z' 再丢 Date，避免被当成本地时间误算日界。
export function sessionDayKey(createdAtSql: string): string {
  if (!createdAtSql) return '';
  const iso = createdAtSql.includes('T') ? createdAtSql : createdAtSql.replace(' ', 'T');
  const withZ = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  return shiftedDayKey(new Date(withZ));
}

export function findActiveMainAgentSessionForDay(day: string): ChatSession | null {
  return getAllSessions().find((session) =>
    isMainAgentSession(session)
    && session.status !== 'archived'
    && sessionDayKey(session.created_at) === day,
  ) || null;
}

export function listMainAgentSessions(limit = 30): ChatSession[] {
  const safe = Math.max(1, Math.min(limit, 365));
  return getAllSessions()
    .filter(isMainAgentSession)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, safe);
}

// 把"日界之前还在 active"的旧主 agent 会话置 archived。
// 同一天的多条不归档（保留容差，防止 IM 推送和 cron tick 抢着建出双胞胎时丢史）。
export function archiveOldActiveMainAgentSessions(beforeDay: string): string[] {
  const archived: string[] = [];
  for (const session of getAllSessions()) {
    if (!isMainAgentSession(session)) continue;
    if (session.status === 'archived') continue;
    if (sessionDayKey(session.created_at) >= beforeDay) continue;
    updateSessionStatus(session.id, 'archived');
    archived.push(session.id);
  }
  return archived;
}

const MAIN_AGENT_BROWSER_KEY = 'main_agent_browser_context';

// 主 Agent 每日新建会话时套用的默认浏览器 context。
// 未配置 / 选了内置 / 配置已失效（profile 删了或停用）→ 返回空，走内置浏览器，向后兼容。
function resolveMainAgentDefaultBrowserContext(): string {
  const raw = (getSetting(MAIN_AGENT_BROWSER_KEY) || '').trim();
  if (!raw || raw === 'embedded:default') return '';
  try {
    return validateBrowserContextId(raw);
  } catch {
    return '';
  }
}

export function resolveMainAgentSession(
  options: { createIfMissing?: boolean } = {},
): ChatSession | null {
  const today = currentMainAgentDayKey();
  const active = findActiveMainAgentSessionForDay(today);
  if (active) return active;
  if (!options.createIfMissing) return null;
  // 一次切日：先归档所有旧的 active 主 agent session，再建今天的（标题=日期）。
  archiveOldActiveMainAgentSessions(today);
  const session = createSession(
    today,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'main-agent',
  );
  // 主 Agent 自动建会话、自动运行，没人手动选浏览器；新会话套用用户配置的默认浏览器。
  const browserContext = resolveMainAgentDefaultBrowserContext();
  if (browserContext) {
    updateSessionBrowserContext(session.id, browserContext);
  }
  return session;
}
