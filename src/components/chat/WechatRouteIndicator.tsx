"use client";

import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  sessionId: string;
}

/**
 * 显示一个 📨 徽章，表示「当前微信路由目标 session 是这个」。
 * 只读：用户在微信里发 /switch 才能切换；UI 不提供修改入口。
 *
 * 每 10s 刷新一次（用户在微信里 /switch 后能看到 lumos UI 跟着变）。
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
          aria-label="当前微信路由目标"
        >
          📨
        </span>
      </TooltipTrigger>
      <TooltipContent>
        微信路由目标 — 你在微信「ClawBot」对话里发的消息会进这个会话。
        在微信发 <code>/switch</code> 切换。
      </TooltipContent>
    </Tooltip>
  );
}
