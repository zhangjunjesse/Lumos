"use client";

import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search, User } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "next-themes";
import { useTranslation } from "@/hooks/useTranslation";

const routeKeys: Record<string, string> = {
  "/": "topbar.workspace",
  "/library": "topbar.workspace",
  "/documents": "topbar.document",
  "/recent": "topbar.recent",
  "/starred": "topbar.starred",
  "/trash": "topbar.trash",
  "/knowledge": "topbar.knowledge",
  "/library-demo": "topbar.workspace",
  "/mind": "topbar.mind",
  "/settings": "topbar.settings",
  "/chat": "topbar.chat",
};

interface TopBarProps {
  onOpenAssistant: () => void;
}

export function TopBar({ onOpenAssistant }: TopBarProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  const routeKey = routeKeys[pathname]
    || (pathname.startsWith("/library") ? "topbar.workspace" : undefined)
    || (pathname.startsWith("/knowledge") ? "topbar.knowledge" : undefined);
  const breadcrumb = routeKey
    ? t(routeKey as Parameters<typeof t>[0])
    : pathname.startsWith("/documents/")
      ? t('topbar.document')
      : pathname.slice(1);

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border/50 px-4">
      <span className="text-sm font-medium text-muted-foreground">
        {breadcrumb}
      </span>

      <div className="flex-1" />

      {/* Search trigger */}
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-2 px-3 text-xs text-muted-foreground"
        onClick={onOpenAssistant}
      >
        <HugeiconsIcon icon={Search} className="h-3.5 w-3.5" />
        <span>{t('topbar.search')}</span>
        <kbd className="ml-2 rounded border bg-muted px-1 text-[10px]">
          ⌘K
        </kbd>
      </Button>

      {/* User avatar menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <HugeiconsIcon icon={User} className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onClick={() =>
              setTheme(theme === "dark" ? "light" : "dark")
            }
          >
            {theme === "dark" ? t('topbar.lightMode') : t('topbar.darkMode')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>{t('sidebar.settings')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
