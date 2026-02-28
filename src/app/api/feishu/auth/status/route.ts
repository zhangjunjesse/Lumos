import { NextResponse } from "next/server";
import { loadToken } from "@/lib/feishu-auth";

export async function GET() {
  try {
    const token = loadToken();

    if (!token) {
      return NextResponse.json({ authenticated: false });
    }

    const expired = Date.now() > token.expiresAt;
    const info = token.userInfo;

    return NextResponse.json({
      authenticated: !expired,
      user: info
        ? { name: info.name, avatarUrl: info.avatar_url, userId: info.open_id }
        : null,
      expiresAt: token.expiresAt,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
