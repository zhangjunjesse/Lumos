"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { UpdateContext, type UpdateInfo } from "@/hooks/useUpdate";

interface UpdateProviderProps {
  children: ReactNode;
}

type NativeUpdateStatusEvent = {
  status: string;
  info?: {
    version?: string;
    releaseNotes?: unknown;
    releaseName?: string | null;
    releaseDate?: string;
  };
  progress?: {
    percent?: number;
  };
  reason?: "auto" | "manual";
  autoDownload?: boolean;
  cached?: boolean;
  error?: string;
};

type NativeUpdateCheckResult = {
  status?: string;
};

function normalizeReleaseNotes(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function buildNativeUpdateInfo(
  data: NativeUpdateStatusEvent,
  previous: UpdateInfo | null,
  overrides: Partial<UpdateInfo> = {}
): UpdateInfo {
  const latestVersion = data.info?.version || previous?.latestVersion || "";
  return {
    updateAvailable: true,
    latestVersion,
    currentVersion: previous?.currentVersion || process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0",
    releaseName: data.info?.releaseName || previous?.releaseName || (latestVersion ? `v${latestVersion}` : ""),
    releaseNotes: normalizeReleaseNotes(data.info?.releaseNotes) || previous?.releaseNotes || "",
    releaseUrl: latestVersion
      ? `https://github.com/zhangjunjesse/Lumos/releases/tag/v${latestVersion}`
      : previous?.releaseUrl || "",
    publishedAt: data.info?.releaseDate || previous?.publishedAt || "",
    downloadProgress: null,
    readyToInstall: false,
    isNativeUpdate: true,
    ...overrides,
  };
}

export function UpdateProvider({ children }: UpdateProviderProps) {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  // Check if running in Electron
  const isElectron = typeof window !== "undefined" && window.electronAPI;

  const checkForUpdates = useCallback(async () => {
    if (!isElectron) {
      // Web version: check via API
      setChecking(true);
      try {
        const res = await fetch("/api/app/updates");
        const data = await res.json();

        if (data.updateAvailable) {
          setUpdateInfo({
            updateAvailable: true,
            latestVersion: data.latestVersion,
            currentVersion: data.currentVersion,
            releaseName: data.releaseName || `v${data.latestVersion}`,
            releaseNotes: data.releaseNotes || "",
            releaseUrl: data.releaseUrl || `https://github.com/zhangjunjesse/Lumos/releases/tag/v${data.latestVersion}`,
            publishedAt: data.publishedAt || "",
            downloadProgress: null,
            readyToInstall: false,
            isNativeUpdate: false,
          });
          setShowDialog(true);
        }
      } catch (err) {
        console.error("[UpdateProvider] Check failed:", err);
      } finally {
        setChecking(false);
      }
      return;
    }

    // Electron version: use native updater
    if (!window.electronAPI) return;

    setChecking(true);
    try {
      const result = await window.electronAPI.updater.checkForUpdates() as NativeUpdateCheckResult | null;
      if (result?.status === 'not-available' || result?.status === 'disabled') {
        setChecking(false);
        setUpdateInfo({
          updateAvailable: false,
          latestVersion: process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0",
          currentVersion: process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0",
          releaseName: "",
          releaseNotes: "",
          releaseUrl: "",
          publishedAt: "",
          downloadProgress: null,
          readyToInstall: false,
          isNativeUpdate: true,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("No handler registered")) {
        setChecking(false);
        return;
      }
      console.error("[UpdateProvider] Native check failed:", err);
      setChecking(false);
    }
  }, [isElectron]);

  const downloadUpdate = useCallback(() => {
    if (!isElectron || !window.electronAPI) return;
    window.electronAPI.updater.downloadUpdate();
  }, [isElectron]);

  const dismissUpdate = useCallback(() => {
    setShowDialog(false);
  }, []);

  const quitAndInstall = useCallback(() => {
    if (!isElectron || !window.electronAPI) return;
    window.electronAPI.updater.quitAndInstall();
  }, [isElectron]);

  // Listen to electron-updater status events
  useEffect(() => {
    if (!isElectron || !window.electronAPI) return;

    const unsubscribe = window.electronAPI.updater.onStatus((data: NativeUpdateStatusEvent) => {
      console.log("[UpdateProvider] Status:", data);

      if (data.status === "checking") {
        setChecking(true);
      } else if (data.status === "available") {
        setChecking(false);
        setUpdateInfo((prev) =>
          buildNativeUpdateInfo(data, prev, {
            downloadProgress: data.autoDownload ? 0 : null,
          })
        );
        setShowDialog(false);
      } else if (data.status === "download-started") {
        setChecking(false);
        setShowDialog(false);
        setUpdateInfo((prev) =>
          prev
            ? {
                ...prev,
                downloadProgress: 0,
                readyToInstall: false,
              }
            : null
        );
      } else if (data.status === "not-available") {
        setChecking(false);
      } else if (data.status === "downloading") {
        setChecking(false);
        setUpdateInfo((prev) =>
          prev
            ? {
                ...prev,
                downloadProgress: data.progress?.percent ?? 0,
                readyToInstall: false,
              }
            : null
        );
      } else if (data.status === "downloaded") {
        setChecking(false);
        setUpdateInfo((prev) =>
          buildNativeUpdateInfo(data, prev, {
            downloadProgress: 100,
            readyToInstall: true,
          })
        );
        if (!data.cached || data.reason === "manual") {
          setShowDialog(true);
        }
      } else if (data.status === "error") {
        setChecking(false);
        console.error("[UpdateProvider] Update error:", data.error);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [isElectron]);

  return (
    <UpdateContext.Provider
      value={{
        updateInfo,
        checking,
        checkForUpdates,
        downloadUpdate,
        dismissUpdate,
        showDialog,
        setShowDialog,
        quitAndInstall,
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
}
