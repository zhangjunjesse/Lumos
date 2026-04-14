"use client";

import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { isPro } from "@/lib/edition";
import { ProLoginPrompt } from "@/components/chat/ProLoginPrompt";
import { ProAuthContext, type ProAuthUser } from "@/hooks/useProAuth";

/**
 * Pro 版全局登录拦截。
 * 包裹在根 layout 中，未登录时整个应用只显示登录表单。
 * Open 版直接透传 children，零开销。
 */
export function ProAuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "login" | "ready">(
    isPro() ? "checking" : "ready"
  );
  const [user, setUser] = useState<ProAuthUser | null>(null);

  useEffect(() => {
    if (!isPro()) return;
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(data => {
        if (data.success && data.data) {
          setUser(data.data);
          setState("ready");
        } else {
          setState("login");
        }
      })
      .catch(() => setState("login"));
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "DELETE" });
    setUser(null);
    setState("login");
  }, []);

  // Single-device login: poll lumos-web via /api/auth/pro-heartbeat.
  // If the server kicked this session (another device logged in), force logout.
  useEffect(() => {
    if (state !== "ready" || !isPro()) return;

    let cancelled = false;
    let running = false;

    const check = async () => {
      if (running || cancelled) return;
      running = true;
      try {
        const r = await fetch("/api/auth/pro-heartbeat", { cache: "no-store" });
        const data = await r.json().catch(() => null);
        if (!cancelled && data && data.valid === false) {
          setUser(null);
          setState("login");
        }
      } catch {
        /* network failure — server treats as inconclusive, we do nothing */
      } finally {
        running = false;
      }
    };

    const interval = setInterval(check, 60_000);
    const onFocus = () => { void check(); };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [state]);

  const ctxValue = useMemo(() => ({ user, logout }), [user, logout]);

  if (state === "checking") {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">正在检查登录状态...</p>
      </div>
    );
  }

  if (state === "login") {
    return (
      <ProLoginPrompt
        onLoggedIn={() => {
          // Re-fetch user info after login
          fetch("/api/auth/me")
            .then(r => r.json())
            .then(data => {
              if (data.success && data.data) setUser(data.data);
            })
            .catch(() => {});
          setState("ready");
        }}
      />
    );
  }

  return (
    <ProAuthContext.Provider value={ctxValue}>
      {children}
    </ProAuthContext.Provider>
  );
}
