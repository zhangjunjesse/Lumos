"use client";

import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { User } from "@hugeicons/core-free-icons";
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
  "/team": "topbar.team",
  "/tasks": "topbar.tasks",
  "/chat": "topbar.chat",
};

export function TopBar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const isMainAgentRoute = pathname === "/main-agent" || pathname.startsWith("/main-agent/");

  if (
    isMainAgentRoute
    || pathname === "/chat"
    || pathname.startsWith("/chat/")
  ) {
    return (
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border/50 px-4">
        <span className="text-sm font-medium text-muted-foreground">
          {t('topbar.mainAgent')}
        </span>

        <div className="flex-1" />

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

  const routeKey = routeKeys[pathname]
    || (pathname.startsWith("/library") ? "topbar.workspace" : undefined)
    || (pathname.startsWith("/knowledge") ? "topbar.knowledge" : undefined)
    || (pathname.startsWith("/tasks/") ? "topbar.tasks" : undefined)
    || (pathname.startsWith("/team/") ? "topbar.team" : undefined);
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
