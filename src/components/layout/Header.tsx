"use client";

import { useTheme } from "next-themes";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Moon, Sun } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isPro } from "@/lib/edition";
import Link from "next/link";

function CloudUserBadge() {
  const [user, setUser] = useState<{ nickname: string; email: string; balance: number } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(data => {
        if (data.success && data.data) setUser(data.data);
      })
      .catch(() => {});
  }, []);

  if (!user) {
    return (
      <Link
        href="/settings#providers"
        className="text-xs text-muted-foreground hover:text-foreground transition px-2 py-1 rounded-md hover:bg-accent"
      >
        登录 Lumos Cloud
      </Link>
    );
  }

  const displayName = user.nickname || user.email;
  const remaining = (user.balance / 500000).toFixed(2);

  return (
    <Link
      href="/settings#providers"
      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition px-2 py-1 rounded-md hover:bg-accent"
    >
      <span className="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center text-primary text-[10px] font-semibold">
        {displayName.charAt(0).toUpperCase()}
      </span>
      <span>¥{remaining}</span>
    </Link>
  );
}

export function Header() {
  const { theme, setTheme } = useTheme();
  const emptySubscribe = useCallback(() => () => {}, []);
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/50 bg-background px-4">
      <div className="ml-auto flex items-center gap-2">
        {isPro() && <CloudUserBadge />}
        {mounted && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="h-7 w-7"
              >
                {theme === "dark" ? (
                  <HugeiconsIcon icon={Sun} className="h-4 w-4" />
                ) : (
                  <HugeiconsIcon icon={Moon} className="h-4 w-4" />
                )}
                <span className="sr-only">Toggle theme</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </header>
  );
}
