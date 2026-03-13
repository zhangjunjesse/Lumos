import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/feishu-auth";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderAuthResultPage(options: {
  title: string;
  subtitle: string;
  details?: string;
  success: boolean;
}): string {
  const title = escapeHtml(options.title);
  const subtitle = escapeHtml(options.subtitle);
  const details = options.details ? escapeHtml(options.details) : "";
  const payload = JSON.stringify({
    type: options.success ? "feishu-auth-success" : "feishu-auth-failed",
  });
  const closeDelay = options.success ? 1200 : 3500;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f8fc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
  <main style="width:min(92vw,460px);background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px 18px;box-shadow:0 8px 30px rgba(15,23,42,.06);text-align:center;">
    <h2 style="margin:0 0 10px;font-size:19px;line-height:1.35;">${title}</h2>
    <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#334155;">${subtitle}</p>
    ${details ? `<p style="margin:0 0 14px;font-size:12px;line-height:1.45;color:#64748b;word-break:break-word;">${details}</p>` : ""}
    <p style="margin:0 0 14px;font-size:12px;line-height:1.45;color:#64748b;">如果页面未自动关闭，请点击下方按钮。</p>
    <button id="close-btn" type="button" style="height:34px;padding:0 14px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;cursor:pointer;">关闭窗口</button>
  </main>
  <script>
    (() => {
      const payload = ${payload};
      const closeWindow = () => {
        try { window.open("", "_self"); } catch {}
        try { window.close(); } catch {}
      };

      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, "*");
        }
      } catch {}

      try {
        localStorage.setItem("lumos:feishu-auth-event", JSON.stringify({ ...payload, timestamp: Date.now() }));
      } catch {}

      const closeBtn = document.getElementById("close-btn");
      if (closeBtn) {
        closeBtn.addEventListener("click", closeWindow);
      }

      setTimeout(closeWindow, ${closeDelay});
    })();
  </script>
</body>
</html>`;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return new NextResponse(
      renderAuthResultPage({
        title: "飞书授权未完成",
        subtitle: "回调参数缺少 code，无法完成登录。",
        details: "请返回 Lumos 后重新发起授权。",
        success: false,
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  try {
    const redirectUri = request.nextUrl.origin;
    console.log("[feishu-auth] callback origin:", redirectUri);
    const tokenData = await exchangeCodeForToken(code, redirectUri);
    const name = tokenData.userInfo?.name || "用户";
    return new NextResponse(
      renderAuthResultPage({
        title: "飞书授权成功",
        subtitle: `欢迎，${name}`,
        details: "窗口将自动关闭并返回 Lumos。",
        success: true,
      }),
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "授权失败";
    return new NextResponse(
      renderAuthResultPage({
        title: "飞书授权失败",
        subtitle: "未能完成 token 交换，请重试。",
        details: msg,
        success: false,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
