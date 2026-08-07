"use client";

/**
 * 远程 MCP 的授权入口。
 *
 * 授权在系统浏览器里完成,页面这边无从得知什么时候好了 —— 所以点完之后轮询
 * 授权状态,成功了自己变。比让用户"授权完再手动刷新一下"少一步。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { openExternalUrl } from "@/lib/open-external";
import type { MCPServer } from "@/types";

type AuthStatus = NonNullable<MCPServer["authStatus"]>;

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

interface McpAuthButtonProps {
  serverId: string;
  status: AuthStatus;
  onChanged: () => void;
}

export function McpAuthButton({ serverId, status, onChanged }: McpAuthButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = null;
    setWaiting(false);
  }, []);

  // 组件卸载(比如用户关掉设置页)时别把定时器留下
  useEffect(() => stopPolling, [stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    setWaiting(true);
    const startedAt = Date.now();
    pollTimer.current = setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        stopPolling();
        return;
      }
      try {
        const res = await fetch(`/api/mcp/oauth/status?serverId=${encodeURIComponent(serverId)}`);
        const data = await res.json();
        if (data?.status?.state === "authorized") {
          stopPolling();
          onChanged();
        }
      } catch {
        /* 轮询失败不打断,等下一次 */
      }
    }, POLL_INTERVAL_MS);
  }, [serverId, onChanged, stopPolling]);

  async function handleAuthorize() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mcp/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "发起授权失败");
      await openExternalUrl(data.authorizationUrl);
      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发起授权失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    setBusy(true);
    try {
      await fetch(`/api/mcp/oauth/status?serverId=${encodeURIComponent(serverId)}`, {
        method: "DELETE",
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const authorized = status.state === "authorized";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {authorized ? (
          <Badge variant="secondary" className="text-xs shrink-0 text-green-700 dark:text-green-300">
            已授权
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs shrink-0">
            {status.state === "expired" ? "授权已过期" : "未授权"}
          </Badge>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={busy}
          onClick={authorized ? handleRevoke : handleAuthorize}
        >
          {authorized ? "取消授权" : waiting ? "等待浏览器授权…" : "授权"}
        </Button>
      </div>
      {error && <span className="text-xs text-destructive max-w-64 text-right">{error}</span>}
    </div>
  );
}
