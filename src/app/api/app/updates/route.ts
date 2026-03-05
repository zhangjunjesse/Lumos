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
  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";

  try {
    // Fetch latest release from GitHub
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Lumos-App",
        },
        next: { revalidate: 3600 }, // Cache for 1 hour
      }
    );

    if (!response.ok) {
      console.error("[updates] GitHub API error:", response.status);
      return NextResponse.json({
        latestVersion: currentVersion,
        currentVersion,
        updateAvailable: false,
      });
    }

    const release = await response.json();
    const latestVersion = release.tag_name?.replace(/^v/, "") || currentVersion;
    const updateAvailable = compareSemver(latestVersion, currentVersion) > 0;

    return NextResponse.json({
      latestVersion,
      currentVersion,
      updateAvailable,
      releaseName: release.name || release.tag_name,
      releaseNotes: release.body || "",
      releaseUrl: release.html_url,
      publishedAt: release.published_at,
    });
  } catch (error) {
    console.error("[updates] Failed to check for updates:", error);
    return NextResponse.json({
      latestVersion: currentVersion,
      currentVersion,
      updateAvailable: false,
    });
  }
}
