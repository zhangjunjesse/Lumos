"use client";

export async function openExternalUrl(url: string): Promise<void> {
  if (typeof window === "undefined") return;

  const target = url.trim();
  if (!target) return;

  if (window.electronAPI?.shell?.openExternal) {
    await window.electronAPI.shell.openExternal(target);
    return;
  }

  window.open(target, "_blank", "noopener,noreferrer,lumos_external=1");
}
