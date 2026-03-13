"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";

interface ClaudeStatus {
  connected: boolean;
  version: string | null;
  sdkVersion?: string | null;
  runtimeSource?: "bundled" | "unavailable";
  sandboxed?: boolean;
  configDir?: string | null;
}

const BASE_INTERVAL = 30_000;
const BACKED_OFF_INTERVAL = 60_000;
const STABLE_THRESHOLD = 3;

export function ConnectionStatus() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const stableCountRef = useRef(0);
  const lastConnectedRef = useRef<boolean | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkRef = useRef<() => void>(() => {});

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const interval = stableCountRef.current >= STABLE_THRESHOLD
      ? BACKED_OFF_INTERVAL
      : BASE_INTERVAL;
    timerRef.current = setTimeout(() => checkRef.current(), interval);
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/claude-status");
      if (res.ok) {
        const data: ClaudeStatus = await res.json();
        if (lastConnectedRef.current === data.connected) {
          stableCountRef.current++;
        } else {
          stableCountRef.current = 0;
        }
        lastConnectedRef.current = data.connected;
        setStatus(data);
      }
    } catch {
      if (lastConnectedRef.current === false) {
        stableCountRef.current++;
      } else {
        stableCountRef.current = 0;
      }
      lastConnectedRef.current = false;
      setStatus({
        connected: false,
        version: null,
        sdkVersion: null,
        runtimeSource: "unavailable",
        sandboxed: true,
        configDir: null,
      });
    }
    schedule();
  }, [schedule]);

  useEffect(() => {
    checkRef.current = checkStatus;
  }, [checkStatus]);

  useEffect(() => {
    checkStatus(); // eslint-disable-line react-hooks/set-state-in-effect
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [checkStatus]);

  const handleManualRefresh = useCallback(() => {
    stableCountRef.current = 0;
    checkStatus();
  }, [checkStatus]);

  const connected = status?.connected ?? false;

  return (
    <>
      <button
        onClick={() => setDialogOpen(true)}
        className={cn(
          "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium transition-colors",
          status === null
            ? "bg-muted text-muted-foreground"
            : connected
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : "bg-red-500/15 text-red-700 dark:text-red-400"
        )}
      >
        <span
          className={cn(
            "block h-1.5 w-1.5 shrink-0 rounded-full",
            status === null
              ? "bg-muted-foreground/40"
              : connected
                ? "bg-emerald-500"
                : "bg-red-500"
          )}
        />
        {status === null
          ? "Checking"
          : connected
            ? "Connected"
            : "Disconnected"}
      </button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {connected ? "Lumos Claude 运行环境已就绪" : "Lumos Claude 运行环境不可用"}
            </DialogTitle>
            <DialogDescription>
              {connected
                ? "Lumos 正在使用自己的内置 Claude 沙箱运行环境。"
                : "Lumos 只使用自己的内置 Claude 沙箱运行环境，不依赖本机 Claude CLI。"}
            </DialogDescription>
          </DialogHeader>

          {connected ? (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3 rounded-lg bg-emerald-500/10 px-4 py-3">
                <span className="block h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                <div>
                  <p className="font-medium text-emerald-700 dark:text-emerald-400">{t('common.active')}</p>
                  <p className="text-xs text-muted-foreground">{t('connection.version', { version: status?.version ?? '' })}</p>
                </div>
              </div>
              <div className="rounded-lg border border-border/50 px-4 py-3 space-y-1">
                <p className="text-xs text-muted-foreground">
                  运行来源：{status?.runtimeSource === "bundled" ? "Lumos 内置运行时" : "未知"}
                </p>
                <p className="text-xs text-muted-foreground">
                  沙箱隔离：{status?.sandboxed ? "已启用" : "未启用"}
                </p>
                {status?.sdkVersion && (
                  <p className="text-xs text-muted-foreground">SDK 版本：{status.sdkVersion}</p>
                )}
                {status?.configDir && (
                  <p className="text-xs text-muted-foreground break-all">配置目录：{status.configDir}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-3 rounded-lg bg-red-500/10 px-4 py-3">
                <span className="block h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
                <p className="font-medium text-red-700 dark:text-red-400">沙箱运行环境未就绪</p>
              </div>
              <p className="text-sm text-muted-foreground">
                请先点击刷新。如果问题持续存在，需要修复当前 Lumos 安装或重新安装应用。
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleManualRefresh}
            >
              {t('connection.refresh')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
