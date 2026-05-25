export type LinkHealth = 'ok' | 'broken' | 'unchecked';

export interface CheckLinkInput {
  provider: string;
  url: string;
  timeoutMs?: number;
}

export interface CheckLinkResult {
  ok: boolean;
  health: LinkHealth;
  reason?: string;
  message?: string;
}

const BROKEN_KEYWORDS: Record<string, string[]> = {
  quark: ['内容不存在', '链接已失效', '资源已删除', '页面无法访问', '违反相关法规'],
  aliyun: ['文件已被删除', '分享已取消', '链接已失效'],
  baidu: ['链接已失效', '分享的文件已经被取消', '该资源已被删除', '资源不存在'],
  lanzou: ['文件不存在', '已被删除', '链接错误'],
  '115': ['分享不存在', '已失效', '已取消分享'],
  other: ['失效', '已删除', '不存在', '404'],
};

export async function checkProductLink(input: CheckLinkInput): Promise<CheckLinkResult> {
  const url = (input.url ?? '').trim();
  if (!url) return { ok: false, health: 'broken', message: '链接为空。' };
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, health: 'broken', message: 'URL 必须以 http(s):// 开头。' };
  }
  const timeoutMs = input.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok && res.status !== 404 && res.status >= 400) {
      return { ok: true, health: 'broken', reason: `HTTP ${res.status}` };
    }
    const text = await readBodySnippet(res);
    const keywords = BROKEN_KEYWORDS[input.provider] ?? BROKEN_KEYWORDS.other;
    const hit = keywords.find((k) => text.includes(k));
    if (hit) {
      return { ok: true, health: 'broken', reason: `命中失效关键词："${hit}"` };
    }
    return { ok: true, health: 'ok' };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, health: 'unchecked', message: `检测超时 (${timeoutMs}ms)` };
    }
    const msg = err instanceof Error ? err.message : '检测失败';
    return { ok: false, health: 'unchecked', message: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function readBodySnippet(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 50_000);
  } catch {
    return '';
  }
}
