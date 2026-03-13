"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Message,
  Grid,
  Image,
  Settings2,
  Moon,
  Sun,
  File,
  BookOpen,
  Brain,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";


interface NavRailProps {
  chatListOpen: boolean;
  onToggleChatList: () => void;
  hasUpdate?: boolean;
  readyToInstall?: boolean;
  skipPermissionsActive?: boolean;
}

const navItems = [
  { href: "/documents", labelKey: "nav.documents" as const, icon: File },
  { href: "/main-agent", labelKey: "nav.mainAgent" as const, icon: Message },
  { href: "/knowledge", labelKey: "nav.knowledge" as const, icon: BookOpen },
  { href: "/mind", labelKey: "nav.mind" as const, icon: Brain },
  { href: "/extensions", labelKey: "nav.extensions" as const, icon: Grid },
  { href: "/gallery", labelKey: "gallery.title" as const, icon: Image },
  { href: "/settings", labelKey: "nav.settings" as const, icon: Settings2 },
] as const;

export function NavRail({ onToggleChatList, hasUpdate, readyToInstall, skipPermissionsActive }: NavRailProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const emptySubscribe = useCallback(() => () => {}, []);
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const isChatRoute = pathname === "/main-agent" || pathname.startsWith("/main-agent/") || pathname === "/chat" || pathname.startsWith("/chat/");

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center bg-sidebar pb-3 pt-10">
      {/* Nav icons */}
      <nav className="flex flex-1 flex-col items-center gap-1">
        {navItems.map((item) => {
          const isActive =
            item.href === "/main-agent"
              ? pathname === "/main-agent" || pathname.startsWith("/main-agent/") || pathname === "/chat" || pathname.startsWith("/chat/")
              : pathname === item.href || pathname.startsWith(item.href + "/");
          const itemLabel = t(item.labelKey);

          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                {item.href === "/main-agent" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-9 w-9",
                      isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
                    )}
                    onClick={() => {
                      if (!isChatRoute) {
                        // Navigate to Main Agent first, then open chat list
                        router.push("/main-agent");
                        onToggleChatList();
                      } else {
                        onToggleChatList();
                      }
                    }}
                  >
                    <HugeiconsIcon icon={item.icon} className="h-4 w-4" />
                    <span className="sr-only">{itemLabel}</span>
                  </Button>
                ) : (
                  <div className="relative">
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-9 w-9",
                        isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
                      )}
                    >
                      <Link href={item.href}>
                        <HugeiconsIcon icon={item.icon} className="h-4 w-4" />
                        <span className="sr-only">{itemLabel}</span>
                      </Link>
                    </Button>
                    {item.href === "/settings" && hasUpdate && (
                      <span className={cn(
                        "absolute top-0.5 right-0.5 h-2 w-2 rounded-full",
                        readyToInstall ? "bg-green-500 animate-pulse" : "bg-blue-500"
                      )} />
                    )}
                  </div>
                )}
              </TooltipTrigger>
              <TooltipContent side="right">{itemLabel}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {/* Bottom: skip-permissions indicator + theme toggle */}
      <div className="mt-auto flex flex-col items-center gap-2">
        {skipPermissionsActive && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex h-8 w-8 items-center justify-center">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-orange-500" />
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">{t('nav.autoApproveOn')}</TooltipContent>
          </Tooltip>
        )}
        {mounted && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="h-8 w-8"
              >
                {theme === "dark" ? (
                  <HugeiconsIcon icon={Sun} className="h-4 w-4" />
                ) : (
                  <HugeiconsIcon icon={Moon} className="h-4 w-4" />
                )}
                <span className="sr-only">{t('nav.toggleTheme')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {theme === "dark" ? t('nav.lightMode') : t('nav.darkMode')}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </aside>
  );
}
