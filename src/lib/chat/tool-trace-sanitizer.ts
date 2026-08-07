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

/**
 * `call <命令>` 这条规则要防的是模型把工具调用打成 shell 风格的正文
 * (`call echo "hello"`)。但命令表里 type/set/copy/move/where/del 全是常用
 * 英文词,于是「call type A 的处理方式如下」这种正常中英混排句子也会命中。
 *
 * 误报的代价远高于漏报:命中后整条回复会被替换成"工具没有执行"的报错,
 * 用户看不到 AI 真正说了什么,只会以为系统坏了;而漏报不过是让一段可疑
 * 文本照常显示。所以这里按整行判:**含中文的行按自然语言放行**。真正的
 * 伪调用是命令格式,不会夹中文叙述。
 */
const CJK_RE = /[㐀-鿿豈-﫿]/;

function hasLeakedCallCommand(text: string): boolean {
  CALL_COMMAND_RE.lastIndex = 0;
  for (const match of text.matchAll(CALL_COMMAND_RE)) {
    if (!CJK_RE.test(match[0])) return true;
  }
  return false;
}

export function hasLeakedToolInvocationText(text: string): boolean {
  if (!text) return false;
  FUNCTION_CALL_RE.lastIndex = 0;
  return hasLeakedCallCommand(text) || FUNCTION_CALL_RE.test(text);
}

function stripLeakedToolInvocationText(text: string): string {
  CALL_COMMAND_RE.lastIndex = 0;
  FUNCTION_CALL_RE.lastIndex = 0;
  return text
    .replace(FUNCTION_CALL_RE, ' ')
    // 与 hasLeakedCallCommand 同一判据:含中文的行是叙述,原样保留
    .replace(CALL_COMMAND_RE, (line) => (CJK_RE.test(line) ? line : '\n'));
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
