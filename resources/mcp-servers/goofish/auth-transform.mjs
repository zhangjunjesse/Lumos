/**
 * Stdio JSON-RPC 帧拦截器：把 goofish-cli 的 mtop session-expired 原始错误
 * 替换成中文友好提示，让 AI 模型能直接告诉用户去重新登录而不是转述机器码。
 *
 * 与 src/lib/goofish/auth-error.ts 的 PATTERNS 保持镜像同步。
 */

const AUTH_PATTERNS = [
  /FAIL_SYS_SESSION_EXPIRED/i,
  /AuthRequiredError/i,
  /登录态失效/,
  /Session\s*过期/,
  /mtop\.taobao\.idlemessage\.pc\.login\.token/i,
  /illegal_session/i,
  /not\s*logged\s*in/i,
  /token\s*invalid/i,
];

const FRIENDLY_AUTH_MESSAGE = '咸鱼登录已过期，请到 Lumos「服务 → 咸鱼」重新扫码登录后再试';

function textIsGoofishAuthExpired(text) {
  if (!text || typeof text !== 'string') return false;
  return AUTH_PATTERNS.some((re) => re.test(text));
}

/** 单帧 JSON-RPC 改写：只动 tool_result 错误的 content[].text，其它帧透传。 */
export function transformFrame(line) {
  if (!line || !line.trim()) return line;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return line;
  }
  const result = msg && typeof msg === 'object' ? msg.result : null;
  if (!result || !Array.isArray(result.content) || !result.isError) return line;
  let touched = false;
  result.content = result.content.map((part) => {
    if (part && part.type === 'text' && textIsGoofishAuthExpired(part.text)) {
      touched = true;
      return { ...part, text: FRIENDLY_AUTH_MESSAGE };
    }
    return part;
  });
  return touched ? JSON.stringify(msg) : line;
}

/** 把 readable 按行拆成 JSON-RPC 帧，过 transformFrame 后写到 writable。 */
export function pipeTransformedFrames(readable, writable) {
  let buf = '';
  readable.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      try {
        writable.write(transformFrame(line) + '\n');
      } catch {
        writable.write(line + '\n');
      }
    }
  });
  readable.on('end', () => {
    if (buf) {
      try { writable.write(transformFrame(buf)); } catch { writable.write(buf); }
    }
  });
}
