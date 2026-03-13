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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTheme } from "next-themes";
import { useTranslation } from "@/hooks/useTranslation";
import { usePanel } from "@/hooks/usePanel";

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

export function TopBar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const { workingDirectory } = usePanel();
  const isChatDetailRoute = /^\/chat\/[^/]+/.test(pathname);
  const showWorkingDirectory = isChatDetailRoute && workingDirectory.trim().length > 0;

  const routeKey = routeKeys[pathname]
    || (pathname.startsWith("/library") ? "topbar.workspace" : undefined)
    || (pathname.startsWith("/knowledge") ? "topbar.knowledge" : undefined)
    || (pathname.startsWith("/chat/") ? "topbar.chat" : undefined);
  const breadcrumb = routeKey
    ? t(routeKey as Parameters<typeof t>[0])
    : pathname.startsWith("/documents/")
      ? t('topbar.document')
      : pathname.slice(1);

  const handleOpenWorkingDirectory = () => {
    if (!showWorkingDirectory) return;
    if (window.electronAPI?.shell?.openPath) {
      window.electronAPI.shell.openPath(workingDirectory);
      return;
    }
    fetch("/api/files/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: workingDirectory }),
    }).catch(() => {});
  };

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border/50 px-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-sm font-medium text-muted-foreground">
          {breadcrumb}
        </span>
        {showWorkingDirectory && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="max-w-[min(56vw,40rem)] truncate text-left font-mono text-xs text-muted-foreground/80 transition-colors hover:text-foreground"
                onClick={handleOpenWorkingDirectory}
                title={workingDirectory}
              >
                {workingDirectory}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              <p className="max-w-xl break-all text-xs">{workingDirectory}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{t('chat.openInFinder')}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

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
