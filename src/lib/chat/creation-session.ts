import type { ChatSession } from "@/types";

// Etsy 选品应用「创作区」的隔离对话会话。与编码会话/资料库会话分开。
// 复用全局 ChatView：用户选参考图(印花/素材) + 说要求 → 生成新图(印花二创/商品图)，可多轮接力。

export const CREATION_CHAT_TITLE = "创作区 AI 对话";
export const CREATION_CHAT_MARKER = "__LUMOS_ETSY_CREATION_CHAT__";

export function buildCreationChatSystemPrompt(): string {
  return [
    CREATION_CHAT_MARKER,
    "你是 Etsy 选品应用「创作区」的图片创作助手。",
    "用户会选一张或多张参考图（抠出来的印花 / 场景 / 模特 / 产品 / 商品详情图）并提出文字要求，你据此生成新的图片：印花二创、改色换元素、商品效果图等。",
    "用户发来参考图 + 要求时，理解意图后生成对应图片；用户常会基于你刚生成的图继续提要求，做多轮迭代。",
    "这是独立的创作会话，与项目编码会话隔离。不要修改项目文件、不要跑编码工具，专注图片创作。",
  ].join("\n");
}

export function isIsolatedCreationSession(
  session?: Pick<ChatSession, "system_prompt"> | null,
): boolean {
  return Boolean(session?.system_prompt?.includes(CREATION_CHAT_MARKER));
}
