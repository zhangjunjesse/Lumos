import { completeAuthorization } from "@/lib/mcp-oauth/authorize";
import { renderCallbackPage } from "@/lib/mcp-oauth/callback-page";

/**
 * OAuth 回调落点。用户在浏览器里授权完会被重定向到这里,所以返回的是给人看的
 * HTML,不是 JSON。
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const error = params.get("error");
  if (error) {
    const detail = params.get("error_description") || error;
    return htmlResponse(renderCallbackPage({ ok: false, message: `授权未完成:${detail}` }), 400);
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    return htmlResponse(
      renderCallbackPage({ ok: false, message: "回调参数不完整,请回到 Lumos 重新授权。" }),
      400,
    );
  }

  try {
    const serverName = await completeAuthorization(state, code);
    return htmlResponse(
      renderCallbackPage({ ok: true, message: `已完成「${serverName}」的授权,可以关闭这个页面了。` }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "授权失败";
    console.error("[mcp-oauth] callback failed:", message);
    return htmlResponse(renderCallbackPage({ ok: false, message }), 400);
  }
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
