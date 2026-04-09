"use client";

import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { Logout, CreditCard, Settings01Icon } from "@hugeicons/core-free-icons";
import { useProAuth } from "@/hooks/useProAuth";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RechargeDialog } from "@/components/payment/RechargeDialog";

const MEMBERSHIP_LABELS: Record<string, string> = {
  free: "免费版",
  monthly: "月卡会员",
  yearly: "年卡会员",
};

function memberLabel(m: string): string {
  return MEMBERSHIP_LABELS[m] || m || "免费版";
}

interface Props {
  expanded: boolean;
}

export function SidebarUserSection({ expanded }: Props) {
  const { user, logout } = useProAuth();

  if (!user) return null;

  const displayName = user.nickname || user.email;
  const initial = displayName.charAt(0).toUpperCase();
  const balance = (user.balance / 500000).toFixed(2);
  const level = memberLabel(user.membership);

  const menuContent = (
    <DropdownMenuContent side="right" align="end" className="w-48">
      <div className="px-2 py-1.5">
        <p className="text-sm font-medium">{displayName}</p>
        <p className="text-xs text-muted-foreground">{user.email}</p>
      </div>
      <DropdownMenuSeparator />
      <div className="px-2 py-1.5 text-xs text-muted-foreground">
        <span>{level}</span>
        <span className="float-right">余额 ¥{balance}</span>
      </div>
      <DropdownMenuSeparator />
      <RechargeDialog
        trigger={
          <DropdownMenuItem onSelect={e => e.preventDefault()}>
            <HugeiconsIcon icon={CreditCard} className="mr-2 h-3.5 w-3.5" />
            充值
          </DropdownMenuItem>
        }
      />
      {user.role === "admin" && (
        <DropdownMenuItem asChild>
          <Link href="/admin">
            <HugeiconsIcon icon={Settings01Icon} className="mr-2 h-3.5 w-3.5" />
            管理后台
          </Link>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
        <HugeiconsIcon icon={Logout} className="mr-2 h-3.5 w-3.5" />
        退出登录
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  if (!expanded) {
    return (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button className="flex h-8 w-full items-center justify-center rounded-md hover:bg-accent transition">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                  {initial}
                </span>
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{displayName}</TooltipContent>
        </Tooltip>
        {menuContent}
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
            "hover:bg-accent transition text-sm"
          )}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">{displayName}</p>
            <p className="truncate text-[10px] text-muted-foreground leading-tight">{level} &middot; ¥{balance}</p>
          </div>
        </button>
      </DropdownMenuTrigger>
      {menuContent}
    </DropdownMenu>
  );
}
