/**
 * Unwrap MCP tool result content.
 *
 * The Claude Agent SDK stores tool results in two possible formats:
 *  1. Direct JSON   — {"success":true, ...}  (user-message path extracted the text)
 *  2. SDK wrapper   — {"content":[{"type":"text","text":"{...json...}"}]}
 *                     (PostToolUse hook stringified the whole CallToolResult)
 *
 * This helper normalises both into a plain Record so callers don't need to
 * care about which path wrote to the DB.
 */
export function unwrapToolResult(raw: unknown): Record<string, unknown> | null {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;

    // Already an object — but might still be a wrapper
    if (!Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      // Wrapper: {content: [{type:'text', text:'...'}], isError?: boolean}
      if (Array.isArray(obj.content)) {
        const text = extractTextFromContentArray(obj.content as Array<Record<string, unknown>>);
        if (text !== null) return text;
      }
      // Direct result
      return obj;
    }

    // Array of content blocks: [{type:'text', text:'...'}]
    const text = extractTextFromContentArray(parsed as Array<Record<string, unknown>>);
    return text;
  } catch {
    return null;
  }
}

function extractTextFromContentArray(
  items: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  for (const item of items) {
    if (item.type === 'text' && typeof item.text === 'string') {
      try {
        const inner = JSON.parse(item.text) as unknown;
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
          return inner as Record<string, unknown>;
        }
      } catch { /* skip non-JSON text */ }
    }
  }
  return null;
}
