"use client";

import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  sessionId: string;
}

/**
 * 显示一个 📨 徽章，表示「微信入口进入这个主 Agent 会话」。
 *
 * 每 10s 刷新一次，用于主 Agent 会话创建 / 切换后的只读状态提示。
 */
export function WechatRouteIndicator({ sessionId }: Props) {
  const [routedId, setRoutedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/im/wechat/route");
        if (!res.ok) return;
        const data = (await res.json()) as { sessionId: string | null };
        if (!cancelled) setRoutedId(data.sessionId ?? null);
      } catch {
        // ignore
      }
    };
    void tick();
    const id = window.setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (routedId !== sessionId) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="ml-1 select-none rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-700 dark:text-emerald-400"
          aria-label="微信入口主 Agent"
        >
          📨
        </span>
      </TooltipTrigger>
      <TooltipContent>
        微信入口 — 你在微信「ClawBot」里发的消息会先进入主 Agent。
      </TooltipContent>
    </Tooltip>
  );
}
