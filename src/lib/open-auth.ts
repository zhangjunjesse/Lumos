"use client";

export async function openAuthUrl(url: string): Promise<void> {
  if (typeof window === "undefined") return;

  const target = url.trim();
  if (!target) return;

  if (window.electronAPI?.auth?.open) {
    await window.electronAPI.auth.open(target);
    return;
  }

  window.open(target, "_blank", "noopener,noreferrer");
}
