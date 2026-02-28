import { NextResponse } from "next/server";
import { clearToken } from "@/lib/feishu-auth";

export async function POST() {
  try {
    clearToken();
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
