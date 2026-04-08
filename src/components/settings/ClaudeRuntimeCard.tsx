"use client";

import { useEffect, useState, useCallback } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Loading,
  Reload,
} from "@hugeicons/core-free-icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUpdate } from "@/hooks/useUpdate";
import { openExternalUrl } from "@/lib/open-external";

interface ClaudeRuntimeStatus {
  connected: boolean;
  version: string | null;
  sdkVersion?: string | null;
  runtimeSource?: "bundled" | "unavailable";
  sandboxed?: boolean;
  configDir?: string | null;
}

interface ClaudeRuntimeCardProps {
  embedded?: boolean;
}

export function ClaudeRuntimeCard({ embedded = false }: ClaudeRuntimeCardProps) {
  const [runtimeStatus, setRuntimeStatus] = useState<ClaudeRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const {
    updateInfo,
    checking: checkingUpdates,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
  } = useUpdate();

  const currentAppVersion = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
  const isDownloadingUpdate = updateInfo?.isNativeUpdate
    && !updateInfo.readyToInstall
    && updateInfo.downloadProgress != null;

  const fetchRuntimeStatus = useCallback(async () => {
    try {
      const runtimeRes = await fetch("/api/claude-status");
      if (runtimeRes.ok) {
        const runtime = await runtimeRes.json() as ClaudeRuntimeStatus;
        setRuntimeStatus(runtime);
      } else {
        setRuntimeStatus(null);
      }
    } catch {
      setRuntimeStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRuntimeStatus();
  }, [fetchRuntimeStatus]);

  const runtimeStatusSection = (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <CardTitle className="text-sm font-medium">AI 引擎</CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">Lumos 内置，无需单独安装</p>
      </div>
      <span className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium ${loading ? 'bg-muted text-muted-foreground' : runtimeStatus?.connected ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-red-500/15 text-red-700 dark:text-red-400'}`}>
        {loading ? "检测中" : runtimeStatus?.connected ? "已就绪" : "不可用"}
      </span>
    </div>
  );

  const updateStrategySection = (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <CardTitle className="text-sm font-medium">版本与更新</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">当前版本 {currentAppVersion}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {updateInfo?.updateAvailable && !checkingUpdates && (
            updateInfo.readyToInstall ? (
              <Button size="sm" onClick={quitAndInstall}>
                重启安装
              </Button>
            ) : updateInfo.isNativeUpdate && !isDownloadingUpdate ? (
              <Button size="sm" onClick={downloadUpdate}>
                下载更新
              </Button>
            ) : !updateInfo.isNativeUpdate && updateInfo.releaseUrl ? (
              <Button size="sm" variant="outline" onClick={() => void openExternalUrl(updateInfo.releaseUrl)}>
                查看发布
              </Button>
            ) : null
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={checkForUpdates}
            disabled={checkingUpdates}
            className="gap-2"
          >
            {checkingUpdates ? (
              <HugeiconsIcon icon={Loading} className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <HugeiconsIcon icon={Reload} className="h-3.5 w-3.5" />
            )}
            {checkingUpdates ? '检查中' : '检查更新'}
          </Button>
        </div>
      </div>
      {updateInfo?.updateAvailable && (
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          {updateInfo.readyToInstall
            ? `已下载 ${updateInfo.latestVersion}，点击「重启安装」完成更新。`
            : isDownloadingUpdate
              ? `正在下载 ${updateInfo.latestVersion}：${Math.round(updateInfo.downloadProgress || 0)}%`
              : `发现新版本 ${updateInfo.latestVersion}，点击「下载更新」升级。`}
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="space-y-6">
        <section className="space-y-3">
          {runtimeStatusSection}
        </section>
        <section className="space-y-3">
          {updateStrategySection}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          {runtimeStatusSection}
        </CardHeader>
        <CardContent />
      </Card>

      <Card className="border-border/50">
        <CardHeader className="pb-3">
          {updateStrategySection}
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  );
}
