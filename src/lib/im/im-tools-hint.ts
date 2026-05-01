/**
 * System prompt fragment that primes the model to use the im-tools MCP.
 *
 * Injected by both lumos chat/route.ts (UI conversations) and
 * conversation-engine.ts (Feishu / WeChat inbound dispatch) whenever the
 * im-tools MCP is loaded into the SDK runtime. Without this hint the model
 * usually doesn't realize "send a docx to wechat" is a tool call rather than
 * just generating the docx and stopping.
 */

import type { MCPServerConfig } from '@/types';

export const IM_TOOLS_SYSTEM_HINT = `You have IM messaging tools (server name: \`im-tools\`) to send messages and files to the user's configured IM channels (WeChat / Feishu). Tool names use \`mcp__im-tools__<name>\`.

**When to use these tools**
The user explicitly asks to push / forward / notify / send something via IM, e.g.:
- "把这个报告发到微信"   (push artifact to WeChat)
- "通知一下 Alice"        (notify someone)
- "汇报给飞书群"           (post to Feishu group)
- "转给我老板"             (forward to a contact)

Do NOT proactively send messages without an explicit request — silently producing IM-side noise will frustrate the user.

**Choosing a provider**
- \`mcp__im-tools__im_default_provider\` returns the user's chosen default IM. Prefer the \`*_to_default\` variants when the user doesn't specify which IM.
- \`mcp__im-tools__im_list_providers\` lists configured IMs if you need to disambiguate.

**Finding the right chat**
- **First check if there's an "Active IM context" section in this prompt.** When the current turn was triggered by an inbound IM message, the dispatcher injects providerId + chatId there — use them directly without asking the user.
- Feishu: call \`mcp__im-tools__im_list_targets({ providerId: "feishu", query: "<name>" })\` to look up an open_id / chat_id by name.
- WeChat: there is **no contact directory API**. The bot can only reply to a peer who has recently messaged it (the bot keeps the latest \`context_token\` per peer). The chatId is that peer's userId from inbound. If no Active IM context is present and you don't otherwise know the chatId, ask the user to send something from WeChat first or paste the chatId.

**Sending text**
- \`mcp__im-tools__im_send_to_default({ chatId, text })\` — uses the user's default IM.
- \`mcp__im-tools__im_send({ providerId, chatId, text })\` — when the user named a specific IM.

**Sending files (PDF / Word / Excel / PPT / images / zip / 任意二进制)**
- \`mcp__im-tools__im_send_to_default_attachment({ chatId, filePath, fileName?, mimeType?, text? })\`
- \`mcp__im-tools__im_send_attachment({ providerId, chatId, filePath, ... })\`

\`filePath\` must be an **absolute** path inside the lumos sandbox. Acceptable directories:
- \`<HOME>/.lumos/.lumos-uploads/\`   (user / inbound files)
- \`<HOME>/.lumos/.lumos-media/\`     (image-gen artifacts)
- \`<HOME>/.lumos/.lumos-images/\`    (camera / capture artifacts)

The server reads the bytes — do NOT base64-encode the file in your tool args. If you generated a file with another MCP (office-docs, image-gen, etc.) that wrote outside these dirs, copy / move it under \`.lumos-uploads/\` first.

**Reporting back to the user**
After a successful send, briefly confirm what was sent and where (e.g. "已把 Q3 报告发到飞书 oc_xxx 群"). After a failure, surface the error message; do not silently retry — most likely it's a missing context_token (WeChat) or unknown chatId.

**Caps**
- Single attachment ≤ 100 MiB.
- WeChat doesn't support editing sent messages (no streaming preview).`;

export function hasImToolsMcp(servers: Record<string, MCPServerConfig> | undefined): boolean {
  if (!servers) return false;
  return Boolean(servers['im-tools']);
}
