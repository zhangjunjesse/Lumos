import { NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/feishu-auth";

export async function GET() {
  try {
    const url = buildAuthUrl();
    return NextResponse.json({ url });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
