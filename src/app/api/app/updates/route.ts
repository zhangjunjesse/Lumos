import { NextResponse } from "next/server";

const GITHUB_REPO = "zhangjunjesse/Lumos";

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function GET() {
  // Update check disabled — this fork has its own release channel
  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
  return NextResponse.json({
    latestVersion: currentVersion,
    currentVersion,
    updateAvailable: false,
  });
}
