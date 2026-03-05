"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { UpdateContext, type UpdateInfo } from "@/hooks/useUpdate";

interface UpdateProviderProps {
  children: ReactNode;
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
      await window.electronAPI.updater.checkForUpdates();
    } catch (err) {
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

    const unsubscribe = window.electronAPI.updater.onStatus((data: any) => {
      console.log("[UpdateProvider] Status:", data);

      if (data.status === "checking") {
        setChecking(true);
      } else if (data.status === "available") {
        setChecking(false);
        setUpdateInfo({
          updateAvailable: true,
          latestVersion: data.info?.version || "",
          currentVersion: process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0",
          releaseName: data.info?.releaseName || `v${data.info?.version}`,
          releaseNotes: data.info?.releaseNotes || "",
          releaseUrl: `https://github.com/zhangjunjesse/Lumos/releases/tag/v${data.info?.version}`,
          publishedAt: data.info?.releaseDate || "",
          downloadProgress: null,
          readyToInstall: false,
          isNativeUpdate: true,
        });
        setShowDialog(true);
      } else if (data.status === "not-available") {
        setChecking(false);
      } else if (data.status === "downloading") {
        setUpdateInfo((prev) =>
          prev
            ? {
                ...prev,
                downloadProgress: data.progress?.percent || 0,
              }
            : null
        );
      } else if (data.status === "downloaded") {
        setUpdateInfo((prev) =>
          prev
            ? {
                ...prev,
                downloadProgress: 100,
                readyToInstall: true,
              }
            : null
        );
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
