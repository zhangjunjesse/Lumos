"use client";

interface ConnectionStatusProps {
  connected: boolean;
  lastSync?: string;
}

export function ConnectionStatus({ connected, lastSync }: ConnectionStatusProps) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-gray-400"}`} />
      <span>{connected ? "已连接" : "未连接"}</span>
      {lastSync && <span className="text-xs text-muted-foreground">· {lastSync}</span>}
    </div>
  );
}
