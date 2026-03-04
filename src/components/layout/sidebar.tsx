"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkspacePicker } from "@/components/workspace/workspace-picker";
import { SidebarNavItem } from "./sidebar-nav-item";
import {
  SparklesIcon,
  DashboardSquare01Icon,
  Clock01Icon,
  StarIcon,
  Delete02Icon,
  BookOpen01Icon,
  PuzzleIcon,
  Settings02Icon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
  Moon02Icon,
  Sun02Icon,
  Globe02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "@/hooks/useTranslation";

const SIDEBAR_EXPANDED_KEY = "lumos_sidebar_expanded";

interface SidebarProps {
  onOpenAssistant: () => void;
}

const mainNavItems = [
  { href: "/", labelKey: "sidebar.aiAssistant" as const, icon: SparklesIcon, isAssistant: true as const },
  { href: "/", labelKey: "sidebar.workspace" as const, icon: DashboardSquare01Icon, isAssistant: false as const },
  { href: "/recent", labelKey: "sidebar.recent" as const, icon: Clock01Icon, isAssistant: false as const },
];

const secondaryNavItems = [
  { href: "/starred", labelKey: "sidebar.starred" as const, icon: StarIcon },
];

const bottomNavItems = [
  { href: "/trash", labelKey: "sidebar.trash" as const, icon: Delete02Icon },
  { href: "/knowledge", labelKey: "sidebar.knowledge" as const, icon: BookOpen01Icon },
  { href: "/extensions", labelKey: "sidebar.extensions" as const, icon: PuzzleIcon },
];

export function Sidebar({ onOpenAssistant }: SidebarProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(SIDEBAR_EXPANDED_KEY) !== "false";
  });

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(next));
      return next;
    });
  }, []);

  // Cmd+\ shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle]);

  // Responsive: collapse on narrow screens
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1279px)");
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setExpanded(false);
    };
    if (mql.matches) setExpanded(false);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/" || pathname === "/documents";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border/50 bg-sidebar transition-[width] duration-200 ease-out",
        expanded ? "w-[220px]" : "w-14"
      )}
    >
      {/* Electron drag region */}
      <div
        className="h-10 w-full shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      {/* Logo */}
      <div className={cn("flex items-center px-3 py-2", expanded ? "gap-2" : "justify-center")}>
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
            L
          </div>
          {expanded && (
            <span className="text-base font-semibold tracking-tight">Lumos</span>
          )}
        </Link>
      </div>

      <ScrollArea className="flex-1 px-2 py-1">
        {/* Main nav */}
        <nav className="space-y-0.5">
          {mainNavItems.map((item) =>
            item.isAssistant ? (
              <SidebarNavItem
                key="assistant"
                icon={item.icon}
                label={t(item.labelKey)}
                expanded={expanded}
                active={false}
                onClick={onOpenAssistant}
              />
            ) : (
              <SidebarNavItem
                key={item.href}
                icon={item.icon}
                label={t(item.labelKey)}
                href={item.href}
                expanded={expanded}
                active={isActive(item.href)}
              />
            )
          )}
        </nav>

        {/* Divider */}
        <div className="my-2 h-px bg-border/50" />

        {/* Secondary nav */}
        <nav className="space-y-0.5">
          {secondaryNavItems.map((item) => (
            <SidebarNavItem
              key={item.href}
              icon={item.icon}
              label={t(item.labelKey)}
              href={item.href}
              expanded={expanded}
              active={isActive(item.href)}
            />
          ))}
        </nav>

        {/* Workspace area */}
        <div className="my-2 h-px bg-border/50" />
        <WorkspacePicker expanded={expanded} />

        {/* Divider */}
        <div className="my-2 h-px bg-border/50" />

        {/* Bottom nav items */}
        <nav className="space-y-0.5">
          {bottomNavItems.map((item) => (
            <SidebarNavItem
              key={item.href}
              icon={item.icon}
              label={t(item.labelKey)}
              href={item.href}
              expanded={expanded}
              active={isActive(item.href)}
            />
          ))}
        </nav>
      </ScrollArea>

      {/* Bottom controls */}
      <div className="border-t border-border/50 px-2 py-2 space-y-0.5">
        <SidebarNavItem
          icon={Settings02Icon}
          label={t('sidebar.settings')}
          href="/settings"
          expanded={expanded}
          active={isActive("/settings")}
        />

        {/* Theme toggle + collapse */}
        <div className={cn("flex items-center", expanded ? "justify-between px-1" : "flex-col gap-1")}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                <HugeiconsIcon
                  icon={theme === "dark" ? Sun02Icon : Moon02Icon}
                  className="h-4 w-4"
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {theme === "dark" ? t('sidebar.lightMode') : t('sidebar.darkMode')}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={toggle}
              >
                <HugeiconsIcon
                  icon={expanded ? SidebarLeft01Icon : SidebarRight01Icon}
                  className="h-4 w-4"
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {expanded ? t('sidebar.collapseSidebar') : t('sidebar.expandSidebar')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
