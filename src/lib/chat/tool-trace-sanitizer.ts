const TOOL_TRACE_PREFIXES = [
  '[Used tool:',
  '[Tool result:',
  '[Reasoning summary:',
] as const;

export const LEAKED_TOOL_INVOCATION_MESSAGE =
  '检测到模型把工具调用当成普通文本输出，本轮工具没有执行。请重试这一步；Lumos 已阻止把这类伪执行文本当成正常结果展示。';

const CALL_COMMAND_RE = /^[ \t]*call[ \t]+(?:true|echo\b|cd\b|dir\b|type\b|copy\b|xcopy\b|move\b|del\b|rm\b|cat\b|ls\b|pwd\b|python\b|node\b|npm\b|npx\b|pnpm\b|yarn\b|git\b|bash\b|sh\b|powershell\b|cmd\b|mkdir\b|rmdir\b|curl\b|wget\b|where\b|whoami\b|set\b|export\b)[^\n\r]*(?:\r?\n|$)/gim;
const FUNCTION_CALL_RE = /<function_calls?\b[\s\S]*?(?:<\/function_calls?>|$)|<invoke\b[\s\S]*?(?:<\/invoke>|$)|<function\b[\s\S]*?(?:<\/function>|\/>|$)/gi;

function tracePrefixAt(text: string, index: number): string | null {
  for (const prefix of TOOL_TRACE_PREFIXES) {
    if (text.startsWith(prefix, index)) return prefix;
  }
  return null;
}

function findTraceMarkerEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === ']') {
      depth -= 1;
      if (depth <= 0) return i + 1;
    }
  }

  return text.length;
}

function cleanupAfterStrip(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/([。！？；：，])\s+(?=[\u3400-\u9fff])/g, '$1')
    .trim();
}

export function hasLeakedToolInvocationText(text: string): boolean {
  if (!text) return false;
  CALL_COMMAND_RE.lastIndex = 0;
  FUNCTION_CALL_RE.lastIndex = 0;
  return CALL_COMMAND_RE.test(text) || FUNCTION_CALL_RE.test(text);
}

function stripLeakedToolInvocationText(text: string): string {
  CALL_COMMAND_RE.lastIndex = 0;
  FUNCTION_CALL_RE.lastIndex = 0;
  return text
    .replace(FUNCTION_CALL_RE, ' ')
    .replace(CALL_COMMAND_RE, '\n');
}

/**
 * Strip fallback-history tool markers that are internal to Lumos and should
 * never be displayed to users or forwarded to IM channels.
 */
export function stripLeakedToolTraceText(text: string): string {
  const hasTraceMarker = TOOL_TRACE_PREFIXES.some((prefix) => text.includes(prefix));
  const hasToolInvocation = hasLeakedToolInvocationText(text);
  if (!text || (!hasTraceMarker && !hasToolInvocation)) {
    return text;
  }

  let out = '';
  let i = 0;
  let changed = false;
  while (i < text.length) {
    const prefix = tracePrefixAt(text, i);
    if (!prefix) {
      out += text[i];
      i += 1;
      continue;
    }

    changed = true;
    out = out.replace(/[ \t]+$/g, '');
    i = findTraceMarkerEnd(text, i);
    while (i < text.length && /[ \t]/.test(text[i])) i += 1;
    if (out && i < text.length && !/[\s,，。.!?！？;；:：]/.test(text[i])) {
      out += ' ';
    }
  }

  const stripped = hasToolInvocation ? stripLeakedToolInvocationText(out) : out;
  return changed || hasToolInvocation ? cleanupAfterStrip(stripped) : text;
}
