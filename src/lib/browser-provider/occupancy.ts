export interface BrowserContextConflictDetails {
  contextId: string;
  message: string;
  ownerId?: string;
  expiresAt?: string;
  lastPath?: string;
  waitedMs?: number;
  retryAfterMs?: number;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMs(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(normalizeText(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function extractFromRecord(record: Record<string, unknown>, fallbackContextId: string): BrowserContextConflictDetails | null {
  const error = normalizeText(record.error);
  const message = normalizeText(record.message);
  const joined = [error, message].filter(Boolean).join(': ');
  if (!/BROWSER_CONTEXT_IN_USE|该浏览器正在被另一个会话使用/.test(joined)) {
    return null;
  }
  const waitedMs = normalizeMs(record.waitedMs);
  const retryAfterMs = normalizeMs(record.retryAfterMs);

  return {
    contextId: normalizeText(record.browserContextId) || normalizeText(record.contextId) || fallbackContextId,
    message: message || '该浏览器正在被另一个会话使用，请稍后再试或释放占用。',
    ...(normalizeText(record.ownerId) ? { ownerId: normalizeText(record.ownerId) } : {}),
    ...(normalizeText(record.expiresAt) ? { expiresAt: normalizeText(record.expiresAt) } : {}),
    ...(normalizeText(record.lastPath) ? { lastPath: normalizeText(record.lastPath) } : {}),
    ...(waitedMs !== undefined ? { waitedMs } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

function maybeJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

export function parseBrowserContextConflict(
  input: unknown,
  fallbackContextId = 'embedded:default',
): BrowserContextConflictDetails | null {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const fromRecord = extractFromRecord(input as Record<string, unknown>, fallbackContextId);
    if (fromRecord) {
      return fromRecord;
    }
  }

  const text = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  if (!/BROWSER_CONTEXT_IN_USE|该浏览器正在被另一个会话使用/.test(text)) {
    return null;
  }

  const parsed = maybeJsonObject(text);
  if (parsed) {
    const fromRecord = extractFromRecord(parsed, fallbackContextId);
    if (fromRecord) {
      return fromRecord;
    }
  }

  const contextMatch = text.match(/browserContextId["']?\s*[:=]\s*["']?([^"',\s}]+)/)
    || text.match(/contextId["']?\s*[:=]\s*["']?([^"',\s}]+)/);
  const ownerMatch = text.match(/ownerId["']?\s*[:=]\s*["']?([^"',\s}]+)/);
  const expiresAtMatch = text.match(/expiresAt["']?\s*[:=]\s*["']?([^"',\s}]+)/);
  const lastPathMatch = text.match(/lastPath["']?\s*[:=]\s*["']?([^"',\s}]+)/);
  const waitedMsMatch = text.match(/waitedMs["']?\s*[:=]\s*["']?(\d+)/);
  const retryAfterMsMatch = text.match(/retryAfterMs["']?\s*[:=]\s*["']?(\d+)/);

  return {
    contextId: contextMatch?.[1] || fallbackContextId,
    message: text.includes('该浏览器正在被另一个会话使用')
      ? '该浏览器正在被另一个会话使用，请稍后再试或释放占用。'
      : '浏览器上下文正在被另一个会话使用。',
    ...(ownerMatch?.[1] ? { ownerId: ownerMatch[1] } : {}),
    ...(expiresAtMatch?.[1] ? { expiresAt: expiresAtMatch[1] } : {}),
    ...(lastPathMatch?.[1] ? { lastPath: lastPathMatch[1] } : {}),
    ...(waitedMsMatch?.[1] ? { waitedMs: Number(waitedMsMatch[1]) } : {}),
    ...(retryAfterMsMatch?.[1] ? { retryAfterMs: Number(retryAfterMsMatch[1]) } : {}),
  };
}
