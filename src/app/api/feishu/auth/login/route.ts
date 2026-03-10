import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, getRedirectUri } from "@/lib/feishu-auth";

export async function GET(request: NextRequest) {
  try {
    const redirectUri = getRedirectUri(request.nextUrl.origin);
    const url = buildAuthUrl(request.nextUrl.origin);
    console.log("[feishu-auth] login redirect_uri:", redirectUri);
    return NextResponse.json({ url, redirectUri });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
