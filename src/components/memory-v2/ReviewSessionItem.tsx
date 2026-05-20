"use client";

import Link from "next/link";
import { ChevronRight, MessageSquare } from "lucide-react";
import type { SourceSession } from "./types";

export function ReviewSessionItem({ session }: { session: SourceSession }) {
  const { id, title, messageCount, digest } = session;
  const firstEvent = digest?.events[0];
  const oneLiner =
    firstEvent?.requirement || firstEvent?.outcome || (digest ? "（无内容）" : "该会话未生成总结");

  return (
    <Link
      href={`/memory-v2/session/${id}`}
      className="flex items-center gap-2 rounded border border-border px-3 py-2 hover:bg-muted/40"
    >
      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium text-foreground">{title || id}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{messageCount} 条消息</span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{oneLiner}</div>
      </div>
      <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground">
        详情
        <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </Link>
  );
}
