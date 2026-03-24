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
import { cn } from "@/lib/utils";
import type { Binding, BridgeHealthBinding, SyncStats } from "./types";

export interface BindingStatusPopoverProps {
  binding: Binding;
  health?: BridgeHealthBinding | null;
  stats: SyncStats | null;
  onToggleSync: (enabled: boolean) => Promise<void>;
  onUnbind: () => Promise<void>;
  onOpenInvite?: () => void;
  onActivatePending?: () => Promise<void>;
  onRelogin?: () => Promise<void>;
  onRetryLatestFailedInbound?: () => Promise<void>;
  activatePendingLoading?: boolean;
  reloginLoading?: boolean;
  retryLatestFailedInboundLoading?: boolean;
  authExpiresAt?: number | null;
  children: React.ReactNode;
}

const bindingStatusLabelMap = {
  pending: "待激活",
  active: "运行中",
  paused: "已暂停",
  expired: "已过期",
  deleted: "已删除",
} satisfies Record<BridgeHealthBinding["bindingStatus"], string>;

const authStatusLabelMap = {
  ok: "已登录",
  missing: "未登录",
  expired: "已过期",
  revoked: "已撤销",
} satisfies Record<BridgeHealthBinding["authStatus"], string>;

const transportStatusLabelMap = {
  starting: "启动中",
  connected: "已连接",
  reconnecting: "重连中",
  disconnected: "未连接",
  stale: "连接陈旧",
} satisfies Record<BridgeHealthBinding["transportStatus"], string>;

const pipelineStatusLabelMap = {
  healthy: "健康",
  degraded: "有降级",
  failing: "异常",
} satisfies Record<BridgeHealthBinding["pipelineStatus"], string>;

function getStatusToneClass(tone: "success" | "warning" | "danger" | "muted"): string {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "danger":
      return "border-red-200 bg-red-50 text-red-700";
    default:
      return "border-border bg-muted/50 text-muted-foreground";
  }
}

function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) return "暂无";
  return new Date(timestamp).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getBindingTone(status: BridgeHealthBinding["bindingStatus"]): "success" | "warning" | "danger" | "muted" {
  if (status === "active") return "success";
  if (status === "expired") return "danger";
  if (status === "paused" || status === "pending") return "warning";
  return "muted";
}

function getAuthTone(status: BridgeHealthBinding["authStatus"]): "success" | "warning" | "danger" {
  if (status === "ok") return "success";
  if (status === "expired" || status === "revoked") return "danger";
  return "warning";
}

function getTransportTone(status: BridgeHealthBinding["transportStatus"]): "success" | "warning" | "danger" {
  if (status === "connected") return "success";
  if (status === "starting" || status === "reconnecting") return "warning";
  return "danger";
}

function getPipelineTone(status: BridgeHealthBinding["pipelineStatus"]): "success" | "warning" | "danger" {
  if (status === "healthy") return "success";
  if (status === "degraded") return "warning";
  return "danger";
}

function HealthStatusChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "danger" | "muted";
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <span
        className={cn(
          "mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
          getStatusToneClass(tone),
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function BindingStatusPopover({
  binding,
  health = null,
  stats,
  onToggleSync,
  onUnbind,
  onOpenInvite,
  onActivatePending,
  onRelogin,
  onRetryLatestFailedInbound,
  activatePendingLoading = false,
  reloginLoading = false,
  retryLatestFailedInboundLoading = false,
  authExpiresAt = null,
  children,
}: BindingStatusPopoverProps) {
  const [open, setOpen] = useState(false);
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const [showUnbindConfirm, setShowUnbindConfirm] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const isPending = binding.status === "pending";
  const isActive = binding.status === "active";
  const isExpired = binding.status === "expired";

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

  const handleRelogin = async () => {
    if (!onRelogin) return;
    await onRelogin();
  };

  const handleActivatePending = async () => {
    if (!onActivatePending) return;
    await onActivatePending();
  };

  const handleRetryLatestFailedInbound = async () => {
    if (!onRetryLatestFailedInbound) return;
    await onRetryLatestFailedInbound();
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

          <div className="border-b border-border p-4 space-y-3">
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-3">
              <p className="text-xs text-muted-foreground">链路概览</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {health?.summary || "暂未获取到同步链路状态"}
              </p>
            </div>

            {health ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <HealthStatusChip
                    label="绑定状态"
                    value={bindingStatusLabelMap[health.bindingStatus]}
                    tone={getBindingTone(health.bindingStatus)}
                  />
                  <HealthStatusChip
                    label="授权状态"
                    value={authStatusLabelMap[health.authStatus]}
                    tone={getAuthTone(health.authStatus)}
                  />
                  <HealthStatusChip
                    label="连接状态"
                    value={transportStatusLabelMap[health.transportStatus]}
                    tone={getTransportTone(health.transportStatus)}
                  />
                  <HealthStatusChip
                    label="处理链路"
                    value={pipelineStatusLabelMap[health.pipelineStatus]}
                    tone={getPipelineTone(health.pipelineStatus)}
                  />
                </div>

                <div className="space-y-2 rounded-lg border border-border bg-background px-3 py-3 text-xs">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">最近收到飞书事件</span>
                    <span className="font-medium text-foreground">
                      {formatTimestamp(health.lastInboundEventAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">最近入站成功</span>
                    <span className="font-medium text-foreground">
                      {formatTimestamp(health.lastInboundSuccessAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">最近出站成功</span>
                    <span className="font-medium text-foreground">
                      {formatTimestamp(health.lastOutboundSuccessAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">连续入站失败</span>
                    <span className="font-medium text-foreground">{health.consecutiveInboundFailures}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">连续出站失败</span>
                    <span className="font-medium text-foreground">{health.consecutiveOutboundFailures}</span>
                  </div>
                </div>

                {health.latestRetryableInboundError ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-700">
                    <p className="font-medium">最近一条飞书入站消息处理异常</p>
                    <p className="mt-1 break-all leading-5">{health.latestRetryableInboundError}</p>
                  </div>
                ) : null}

                {health.latestRetryableInboundEventId && onRetryLatestFailedInbound ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={handleRetryLatestFailedInbound}
                    disabled={retryLatestFailedInboundLoading}
                  >
                    {retryLatestFailedInboundLoading ? "重试中..." : "重试最近异常消息"}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>

          {/* 同步统计 */}
          {stats && <SyncStatsPanel stats={stats} />}

          {isExpired && (
            <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <p>飞书登录已失效，同步已暂停。</p>
              {authExpiresAt ? (
                <p className="mt-1">失效时间：{formatDate(authExpiresAt)}</p>
              ) : null}
              {onRelogin ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 h-7 border-red-300 text-red-700 hover:bg-red-100"
                  onClick={handleRelogin}
                  disabled={reloginLoading}
                >
                  {reloginLoading ? "重新登录中..." : "重新登录飞书"}
                </Button>
              ) : null}
            </div>
          )}

          {isPending && (
            <div className="mx-4 mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700">
              <p className="font-medium">当前还未正式激活同步</p>
              <p className="mt-1">需要先扫码加入飞书群组，再点击“开始同步”。</p>
              <div className="mt-3 flex gap-2">
                {onOpenInvite ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={onOpenInvite}
                  >
                    查看二维码
                  </Button>
                ) : null}
                {onActivatePending ? (
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={handleActivatePending}
                    disabled={activatePendingLoading}
                  >
                    {activatePendingLoading ? "激活中..." : "开始同步"}
                  </Button>
                ) : null}
              </div>
            </div>
          )}

          {/* 同步开关 */}
          <div className="flex items-center justify-between p-4 border-t border-border">
            <span className="text-sm font-medium">同步开关</span>
            <Switch
              checked={isActive && !isExpired}
              onCheckedChange={handleToggleSync}
              disabled={isToggling || isExpired || isPending}
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
