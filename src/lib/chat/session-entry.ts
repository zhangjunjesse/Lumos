import type { ChatSession } from '@/types';

export const MAIN_AGENT_SESSION_MARKER = '__LUMOS_MAIN_AGENT__';

export type SessionEntry = 'chat' | 'main-agent';

type SessionPromptCarrier = Pick<ChatSession, 'system_prompt'> | null | undefined;

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

export function isMainAgentSession(session?: SessionPromptCarrier): boolean {
  return String(session?.system_prompt || '').includes(MAIN_AGENT_SESSION_MARKER);
}

export function getSessionEntry(session?: SessionPromptCarrier): SessionEntry {
  return isMainAgentSession(session) ? 'main-agent' : 'chat';
}

export function stripMainAgentSessionMarker(systemPrompt?: string | null): string {
  return String(systemPrompt || '')
    .split('\n')
    .filter((line) => line.trim() !== MAIN_AGENT_SESSION_MARKER)
    .join('\n')
    .replace(/^\n+/, '');
}

export function withSessionEntryMarker(
  systemPrompt: string | undefined,
  entry: SessionEntry,
): string {
  const promptWithoutMarker = stripMainAgentSessionMarker(systemPrompt);
  if (entry !== 'main-agent') {
    return promptWithoutMarker;
  }
  return promptWithoutMarker
    ? `${MAIN_AGENT_SESSION_MARKER}\n${promptWithoutMarker}`
    : MAIN_AGENT_SESSION_MARKER;
}
