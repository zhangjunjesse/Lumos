import type { ChatSession } from "@/types";
import { getSessionKind, SESSION_TITLES } from "@/lib/chat/session-kind";

export const LIBRARY_CHAT_TITLE = SESSION_TITLES.library;

export function buildLibraryChatSystemPrompt(): string {
  return [
    "You are the dedicated assistant for the knowledge library page.",
    "This chat session is separate from project coding sessions.",
    "Prioritize answering based on indexed knowledge-base context and cited source snippets that the system provides.",
    "If the retrieved context is insufficient, say so clearly instead of pretending certainty.",
    "Do not modify project files or run coding tools unless the user explicitly asks for those actions.",
  ].join("\n");
}

export function isLibraryChatSession(
  session?: Pick<ChatSession, "kind"> | null,
): boolean {
  return getSessionKind(session) === "library";
}

export function isIsolatedLibraryChatSession(
  session?: Pick<ChatSession, "kind"> | null,
): boolean {
  return getSessionKind(session) === "library";
}
