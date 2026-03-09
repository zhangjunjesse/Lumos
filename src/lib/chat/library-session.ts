import type { ChatSession } from "@/types";

export const LIBRARY_CHAT_TITLE = "资料库 AI 对话";
export const LIBRARY_CHAT_MARKER = "__LUMOS_LIBRARY_CHAT__";
const LIBRARY_CHAT_LEGACY_FRAGMENT = "dedicated assistant for the knowledge library page";

export function buildLibraryChatSystemPrompt(): string {
  return [
    LIBRARY_CHAT_MARKER,
    "You are the dedicated assistant for the knowledge library page.",
    "This chat session is separate from project coding sessions.",
    "Prioritize answering based on indexed knowledge-base context and cited source snippets that the system provides.",
    "If the retrieved context is insufficient, say so clearly instead of pretending certainty.",
    "Do not modify project files or run coding tools unless the user explicitly asks for those actions.",
  ].join("\n");
}

export function isLibraryChatSession(
  session?: Pick<ChatSession, "title" | "system_prompt"> | null,
): boolean {
  if (!session) return false;
  const title = String(session.title || "").trim();
  const prompt = String(session.system_prompt || "");
  if (prompt.includes(LIBRARY_CHAT_MARKER)) return true;
  return title === LIBRARY_CHAT_TITLE && prompt.includes(LIBRARY_CHAT_LEGACY_FRAGMENT);
}

export function isIsolatedLibraryChatSession(
  session?: Pick<ChatSession, "system_prompt"> | null,
): boolean {
  return Boolean(session?.system_prompt?.includes(LIBRARY_CHAT_MARKER));
}
