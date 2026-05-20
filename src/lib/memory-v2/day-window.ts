// 把「本地某一天」翻译成 messages.created_at 能比较的 UTC 时间戳区间。
// messages.created_at 存的是 UTC ISO（'YYYY-MM-DD HH:MM:SS'），所以本地日界要换算回 UTC。

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function resolveTimezone(value?: string | null): string {
  const raw = String(value || '').trim();
  const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  const candidate = raw || fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return fallback;
  }
}

function partsInTz(at: Date, timezone: string): Record<string, number> {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const part of dtf.formatToParts(at)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return out;
}

export function localDayKey(at: Date, timezone: string): string {
  const p = partsInTz(at, timezone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// timezone 相对 UTC 的偏移（毫秒，本地领先 UTC 为正）。DST 切换日按所给时刻取值。
function tzOffsetMs(at: Date, timezone: string): number {
  const p = partsInTz(at, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

function toSql(at: Date): string {
  return at.toISOString().replace('T', ' ').split('.')[0];
}

// 给定本地 dayKey（YYYY-MM-DD），返回该自然日 [start, end) 对应的 UTC SQL 时间戳。
export function dayRangeUtcSql(dayKey: string, timezone: string): { startSql: string; endSql: string } {
  const [year, month, day] = dayKey.split('-').map(Number);
  const guessStart = Date.UTC(year, month - 1, day, 0, 0, 0);
  const startOffset = tzOffsetMs(new Date(guessStart), timezone);
  const start = new Date(guessStart - startOffset);
  const guessEnd = Date.UTC(year, month - 1, day + 1, 0, 0, 0);
  const endOffset = tzOffsetMs(new Date(guessEnd), timezone);
  const end = new Date(guessEnd - endOffset);
  return { startSql: toSql(start), endSql: toSql(end) };
}
