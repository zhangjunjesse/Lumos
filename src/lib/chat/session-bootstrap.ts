import type { FileAttachment } from '@/types';

const STORAGE_KEY = 'lumos:chat-session-bootstrap:v1';
const MAX_AGE_MS = 10 * 60 * 1000;

export interface PendingChatBootstrap {
  sessionId: string;
  content: string;
  files?: FileAttachment[];
  systemPromptAppend?: string;
  displayOverride?: string;
  createdAt: number;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';
}

function readBootstraps(): Record<string, PendingChatBootstrap> {
  if (!isBrowser()) {
    return {};
  }

  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, PendingChatBootstrap>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeBootstraps(payload: Record<string, PendingChatBootstrap>): void {
  if (!isBrowser()) {
    return;
  }

  const entries = Object.entries(payload).filter(([, value]) => {
    return typeof value?.sessionId === 'string' && Date.now() - (value.createdAt || 0) <= MAX_AGE_MS;
  });

  if (entries.length === 0) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }

  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

export function stashPendingChatBootstrap(
  payload: Omit<PendingChatBootstrap, 'createdAt'>,
): void {
  if (!isBrowser()) {
    return;
  }

  const next = readBootstraps();
  next[payload.sessionId] = {
    ...payload,
    createdAt: Date.now(),
  };
  writeBootstraps(next);
}

export function consumePendingChatBootstrap(sessionId: string): PendingChatBootstrap | null {
  if (!isBrowser() || !sessionId) {
    return null;
  }

  const stored = readBootstraps();
  const payload = stored[sessionId];
  if (!payload) {
    writeBootstraps(stored);
    return null;
  }

  delete stored[sessionId];
  writeBootstraps(stored);

  if (Date.now() - (payload.createdAt || 0) > MAX_AGE_MS) {
    return null;
  }

  return payload;
}
