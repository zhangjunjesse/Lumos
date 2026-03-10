import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/feishu-auth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return new NextResponse("Missing code parameter", { status: 400 });
  }

  try {
    const redirectUri = request.nextUrl.origin;
    console.log("[feishu-auth] callback origin:", redirectUri);
    const tokenData = await exchangeCodeForToken(code, redirectUri);
    const name = tokenData.userInfo?.name || "用户";

    // Return HTML that auto-closes the popup window
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>授权成功</title></head>
<body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">
<div style="text-align:center">
  <h2>✅ 飞书授权成功</h2>
  <p>欢迎，${name}</p>
  <p>窗口将自动关闭...</p>
</div>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: "feishu-auth-success" }, "*");
  }
  setTimeout(() => window.close(), 1500);
</script>
</body></html>`;

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "授权失败";
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>授权失败</title></head>
<body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">
<div style="text-align:center">
  <h2>❌ 授权失败</h2>
  <p>${msg}</p>
  <p>请关闭窗口后重试</p>
</div>
</body></html>`;

    return new NextResponse(html, {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}
