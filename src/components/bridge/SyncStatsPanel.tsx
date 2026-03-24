"use client";

import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01,
  ArrowRight,
  Message,
  CheckmarkCircle02Icon,
  Cancel,
  Clock1,
} from "@hugeicons/core-free-icons";
import type { SyncStats } from "./types";

export interface SyncStatsPanelProps {
  stats: SyncStats;
}

export function SyncStatsPanel({ stats }: SyncStatsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  const formatTime = (timestamp: number | null) => {
    if (!timestamp) return "从未同步";
    return new Date(timestamp).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border-t border-border">
      <CollapsibleTrigger className="flex w-full items-center justify-between p-4 hover:bg-muted/50 transition-colors">
        <span className="text-sm font-medium">同步统计</span>
        <HugeiconsIcon
          icon={isOpen ? ArrowDown01 : ArrowRight}
          className="h-3 w-3 text-muted-foreground"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4 space-y-3">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={Message} className="h-4 w-4 text-[#3B82F6]" />
          <span className="text-lg font-semibold">{stats.totalMessages}</span>
          <span className="text-sm text-muted-foreground">总消息数</span>
        </div>
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-4 w-4 text-[#10B981]" />
          <span className="text-lg font-semibold">{stats.successCount}</span>
          <span className="text-sm text-muted-foreground">成功数</span>
        </div>
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={Cancel} className="h-4 w-4 text-[#EF4444]" />
          <span className={`text-lg font-semibold ${stats.failedCount > 0 ? "text-[#EF4444]" : ""}`}>
            {stats.failedCount}
          </span>
          <span className="text-sm text-muted-foreground">失败数</span>
        </div>
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={Clock1} className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">最后同步：{formatTime(stats.lastSyncAt)}</span>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
