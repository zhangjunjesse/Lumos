export const DEFAULT_X_READ_TIMEOUT_MS = 25_000;
export const MAX_X_READ_TIMEOUT_MS = 300_000;

export class XReadTimeoutError extends Error {
  readonly code = 'X_READ_TIMEOUT';

  constructor(message: string) {
    super(message);
  }
}

export function isXReadTimeoutError(error: unknown): error is XReadTimeoutError {
  return error instanceof XReadTimeoutError
    || (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'X_READ_TIMEOUT');
}

export function normalizeXReadTimeoutMs(timeoutMs?: number): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
    return DEFAULT_X_READ_TIMEOUT_MS;
  }
  return Math.max(100, Math.min(MAX_X_READ_TIMEOUT_MS, timeoutMs));
}

export async function withXTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  if (timeoutMs <= 0) throw new XReadTimeoutError(`${label} 超时`);
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new XReadTimeoutError(`${label} 超时`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function nextWithXTimeout<T>(
  iterator: AsyncIterator<T>,
  remainingMs: number,
  label: string,
): Promise<IteratorResult<T>> {
  if (remainingMs <= 0) throw new XReadTimeoutError(`${label} 超时`);
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new XReadTimeoutError(`${label} 超时`)), remainingMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
