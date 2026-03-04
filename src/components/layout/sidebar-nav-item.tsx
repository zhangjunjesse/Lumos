"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SidebarNavItemProps {
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  label: string;
  href?: string;
  expanded: boolean;
  active: boolean;
  onClick?: () => void;
  comingSoon?: boolean;
}

export function SidebarNavItem({
  icon,
  label,
  href,
  expanded,
  active,
  onClick,
  comingSoon,
}: SidebarNavItemProps) {
  const handleClick = () => {
    if (comingSoon) {
      alert("功能即将上线，敬请期待");
      return;
    }
    onClick?.();
  };

  const content = (
    <div
      className={cn(
        "group relative flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        active && "bg-accent text-accent-foreground font-semibold",
        !expanded && "justify-center px-0"
      )}
    >
      {/* Active indicator */}
      {active && (
        <div className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
      )}
      <HugeiconsIcon icon={icon} className="h-4 w-4 shrink-0" />
      {expanded && <span className="truncate">{label}</span>}
    </div>
  );

  const wrapped = expanded ? (
    content
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );

  if (comingSoon || onClick) {
    return (
      <button type="button" className="w-full" onClick={handleClick}>
        {wrapped}
      </button>
    );
  }

  if (href) {
    return <Link href={href}>{wrapped}</Link>;
  }

  return wrapped;
}
