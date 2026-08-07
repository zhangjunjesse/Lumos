/**
 * 授权回调页。用户在系统浏览器里看到的最后一屏,只负责告诉他成败、可以关掉了。
 *
 * 失败原因里含服务器返回的文本,必须转义后再插进 HTML —— 这是从外部进来的内容。
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderCallbackPage(args: { ok: boolean; message: string }): string {
  const { ok, message } = args;
  const title = ok ? '授权成功' : '授权失败';
  const accent = ok ? '#16a34a' : '#dc2626';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Lumos</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #fafafa; color: #18181b;
  }
  .card {
    max-width: 420px; padding: 32px; border: 1px solid #e4e4e7; border-radius: 12px;
    background: #fff; text-align: center;
  }
  h1 { margin: 0 0 12px; font-size: 17px; font-weight: 600; color: ${accent}; }
  p { margin: 0; color: #52525b; word-break: break-word; }
  @media (prefers-color-scheme: dark) {
    body { background: #09090b; color: #fafafa; }
    .card { background: #18181b; border-color: #27272a; }
    p { color: #a1a1aa; }
  }
</style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}
