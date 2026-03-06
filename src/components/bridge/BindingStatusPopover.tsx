"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel } from "@hugeicons/core-free-icons";
import { SyncStatsPanel } from "./SyncStatsPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import type { Binding, SyncStats } from "./types";

export interface BindingStatusPopoverProps {
  binding: Binding;
  stats: SyncStats | null;
  onToggleSync: (enabled: boolean) => Promise<void>;
  onUnbind: () => Promise<void>;
  children: React.ReactNode;
}

export function BindingStatusPopover({
  binding,
  stats,
  onToggleSync,
  onUnbind,
  children,
}: BindingStatusPopoverProps) {
  const [open, setOpen] = useState(false);
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const [showUnbindConfirm, setShowUnbindConfirm] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const isActive = binding.status === "active";

  const handleToggleSync = async (checked: boolean) => {
    if (!checked) {
      // 暂停操作需要确认
      setShowPauseConfirm(true);
    } else {
      // 恢复操作直接执行
      setIsToggling(true);
      await onToggleSync(true);
      setIsToggling(false);
    }
  };

  const handleConfirmPause = async () => {
    setIsToggling(true);
    await onToggleSync(false);
    setIsToggling(false);
  };

  const handleUnbind = async () => {
    await onUnbind();
    setOpen(false);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {children}
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="end">
          {/* 头部 */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="text-lg font-semibold">飞书同步</h3>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setOpen(false)}
              aria-label="关闭"
            >
              <HugeiconsIcon icon={Cancel} className="h-4 w-4" />
            </Button>
          </div>

          {/* 群组信息 */}
          <div className="p-4 space-y-3 border-b border-border">
            <div>
              <p className="text-xs text-muted-foreground">群组名称</p>
              <p className="text-base font-semibold mt-1">
                {binding.platform_chat_name || "未命名群组"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">绑定时间</p>
              <p className="text-sm text-foreground mt-1">
                {formatDate(binding.created_at)}
              </p>
            </div>
          </div>

          {/* 同步统计 */}
          {stats && <SyncStatsPanel stats={stats} />}

          {/* 同步开关 */}
          <div className="flex items-center justify-between p-4 border-t border-border">
            <span className="text-sm font-medium">同步开关</span>
            <Switch
              checked={isActive}
              onCheckedChange={handleToggleSync}
              disabled={isToggling}
              aria-label="同步开关"
            />
          </div>

          {/* 解绑按钮 */}
          <div className="p-4 border-t border-border">
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => setShowUnbindConfirm(true)}
            >
              解绑
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* 暂停确认对话框 */}
      <ConfirmDialog
        open={showPauseConfirm}
        onOpenChange={setShowPauseConfirm}
        title="暂停同步"
        description="暂停后消息将不再同步，确定暂停吗？"
        confirmText="确认"
        cancelText="取消"
        onConfirm={handleConfirmPause}
      />

      {/* 解绑确认对话框 */}
      <ConfirmDialog
        open={showUnbindConfirm}
        onOpenChange={setShowUnbindConfirm}
        title="解绑飞书群组"
        description={[
          "解绑后消息将不再同步，飞书群组将保留",
          "确定解绑吗？"
        ]}
        confirmText="确认解绑"
        cancelText="取消"
        variant="destructive"
        showWarningIcon
        onConfirm={handleUnbind}
      />
    </>
  );
}
