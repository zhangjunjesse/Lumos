import { NextResponse } from "next/server";
import { ensureActiveFeishuToken, loadToken } from "@/lib/feishu-auth";

export async function GET() {
  try {
    const storedToken = loadToken();
    const token = await ensureActiveFeishuToken();
    const now = Date.now();

    if (!token) {
      return NextResponse.json({
        authenticated: false,
        reason: storedToken ? "expired" : "missing",
        expiresAt: storedToken?.expiresAt ?? null,
        refreshExpiresAt: storedToken?.refreshExpiresAt ?? null,
        remainingMs: storedToken ? storedToken.expiresAt - now : null,
        refreshRemainingMs: storedToken ? storedToken.refreshExpiresAt - now : null,
        willExpireSoon: false,
      });
    }

    const expired = now > token.expiresAt;
    const remainingMs = token.expiresAt - now;
    const refreshExpiresAt =
      typeof token.refreshExpiresAt === "number" ? token.refreshExpiresAt : null;
    const refreshRemainingMs =
      typeof refreshExpiresAt === "number" ? refreshExpiresAt - now : null;
    const info = token.userInfo;

    return NextResponse.json({
      authenticated: !expired,
      reason: expired ? "expired" : "ok",
      user: info
        ? { name: info.name, avatarUrl: info.avatar_url, userId: info.open_id }
        : null,
      expiresAt: token.expiresAt,
      refreshExpiresAt,
      remainingMs,
      refreshRemainingMs,
      willExpireSoon: !expired && remainingMs <= 5 * 60 * 1000,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
