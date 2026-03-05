"use client";

interface SyncStatusProps {
  syncing: boolean;
  lastSyncTime?: string;
  messageCount?: number;
}

export function SyncStatus({ syncing, lastSyncTime, messageCount = 0 }: SyncStatusProps) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {syncing && <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />}
      <span>
        {syncing ? "同步中..." : lastSyncTime ? `最后同步: ${lastSyncTime}` : "未同步"}
      </span>
      {messageCount > 0 && <span>· {messageCount} 条消息</span>}
    </div>
  );
}
