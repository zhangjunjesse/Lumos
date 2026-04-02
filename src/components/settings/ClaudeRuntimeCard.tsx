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
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <CardTitle className="text-sm font-medium">
            Lumos Claude 运行环境
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            Lumos 使用内置的独立 Claude 运行环境，不依赖本机 Claude。
          </p>
        </div>
        <span className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium ${runtimeStatus?.connected ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-red-500/15 text-red-700 dark:text-red-400'}`}>
          {loading ? "检测中" : runtimeStatus?.connected ? "已就绪" : "不可用"}
        </span>
      </div>
      {loading ? (
        <div className="flex items-center py-6 text-sm text-muted-foreground">
          <HugeiconsIcon icon={Loading} className="mr-2 h-4 w-4 animate-spin" />
          正在读取运行环境状态
        </div>
      ) : (
        <div className="grid gap-x-4 gap-y-1.5 text-xs text-muted-foreground sm:grid-cols-2">
          <p>Runtime 版本：{runtimeStatus?.version || '未知'}</p>
          <p>SDK 版本：{runtimeStatus?.sdkVersion || '未知'}</p>
          <p>运行来源：{runtimeStatus?.runtimeSource === 'bundled' ? 'Lumos 内置' : '未知'}</p>
          <p>环境隔离：{runtimeStatus?.sandboxed ? '已启用' : '未启用'}</p>
          {runtimeStatus?.configDir && (
            <p className="sm:col-span-2 break-all">配置目录：{runtimeStatus.configDir}</p>
          )}
        </div>
      )}
    </>
  );

  const updateStrategySection = (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-sm font-medium">
            运行时更新策略
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            内置 Claude Runtime 不单独升级，它跟随 Lumos 应用版本一起更新。
          </p>
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
            {checkingUpdates ? '检查中' : '检查 Lumos 更新'}
          </Button>
        </div>
      </div>
      <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
        <p>Lumos 版本：{currentAppVersion}</p>
        <p>内置 Runtime：{runtimeStatus?.version || '未知'}</p>
      </div>
      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        {updateInfo ? (
          updateInfo.updateAvailable ? (
            updateInfo.readyToInstall
              ? `已下载 ${updateInfo.latestVersion}，重启后会同时更新 Lumos 和内置 Claude 运行时。`
              : isDownloadingUpdate
                ? `正在下载 ${updateInfo.latestVersion}：${Math.round(updateInfo.downloadProgress || 0)}%`
                : `检测到新版本 ${updateInfo.latestVersion}。升级后，内置 Claude Runtime 也会一起更新。`
          ) : (
            '当前已经是最新版本，内置 Claude Runtime 也保持在当前应用附带版本。'
          )
        ) : (
          '如果你要拿到新的内置 Claude 运行时，直接升级 Lumos 即可，不需要单独安装本机 Claude。'
        )}
      </div>
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
