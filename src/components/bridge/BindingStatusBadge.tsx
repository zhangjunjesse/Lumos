"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BindingBadgeStatus } from "./types";

export interface BindingStatusBadgeProps {
  status: BindingBadgeStatus;
  onClick?: () => void;
  className?: string;
}

const badgeConfig = {
  pending: {
    label: "待完成",
    className: "bg-slate-500 text-white hover:bg-slate-600 cursor-pointer",
  },
  active: {
    label: "已绑定",
    className: "bg-[#10B981] text-white hover:bg-[#059669] cursor-pointer",
  },
  inactive: {
    label: "已暂停",
    className: "bg-[#F59E0B] text-white hover:bg-[#D97706] cursor-pointer",
  },
  expired: {
    label: "登录失效",
    className: "bg-[#EF4444] text-white hover:bg-[#DC2626] cursor-pointer",
  },
  degraded: {
    label: "同步异常",
    className: "bg-[#F59E0B] text-white hover:bg-[#D97706] cursor-pointer",
  },
  failing: {
    label: "连接异常",
    className: "bg-[#DC2626] text-white hover:bg-[#B91C1C] cursor-pointer",
  },
};

export function BindingStatusBadge({ status, onClick, className }: BindingStatusBadgeProps) {
  const config = badgeConfig[status];

  return (
    <Badge
      className={cn(
        "h-7 px-3 rounded-full gap-1.5 transition-all",
        config.className,
        onClick && "hover:scale-105",
        className
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      aria-label={onClick ? `${config.label}，点击查看详情` : config.label}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      } : undefined}
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
      </svg>
      <span className="text-sm font-medium">{config.label}</span>
    </Badge>
  );
}
