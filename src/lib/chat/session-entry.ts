import type { ChatSession } from '@/types';
import { getSessionKind } from './session-kind';

export type SessionEntry = 'chat' | 'main-agent';

type SessionKindCarrier = Pick<ChatSession, 'kind'> | null | undefined;

export function isWorkflowDebugSession(
  session?: Pick<ChatSession, 'mode'> | null,
): boolean {
  return session?.mode === 'workflow';
}

export function normalizeSessionEntry(value?: string | null): SessionEntry {
  return value === 'main-agent' ? 'main-agent' : 'chat';
}

export function getSessionEntryFromPath(pathname?: string | null): SessionEntry {
  if (pathname === '/chat' || pathname?.startsWith('/chat/')) {
    return 'chat';
  }
  return 'main-agent';
}

export function getSessionEntryBasePath(entry: SessionEntry): string {
  return entry === 'main-agent' ? '/main-agent' : '/chat';
}

export function getPostDeleteRedirectPath(
  entry: SessionEntry,
  fallbackSessionId?: string | null,
): string {
  const basePath = getSessionEntryBasePath(entry);
  if (entry === 'main-agent') {
    return basePath;
  }
  return fallbackSessionId ? `${basePath}/${fallbackSessionId}` : basePath;
}

export function isMainAgentSession(session?: SessionKindCarrier): boolean {
  return getSessionKind(session) === 'main-agent';
}

export function getSessionEntry(session?: SessionKindCarrier): SessionEntry {
  return isMainAgentSession(session) ? 'main-agent' : 'chat';
}
