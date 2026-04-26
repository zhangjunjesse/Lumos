"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { isPro } from "@/lib/edition";
import { ProLoginPrompt } from "@/components/chat/ProLoginPrompt";
import { setProAuthStore } from "@/hooks/useProAuth";

/**
 * Pro 版全局登录拦截。
 * 包裹在根 layout 中，未登录时整个应用只显示登录表单。
 * Open 版直接透传 children，零开销。
 *
 * 用户数据写入 module 级 store(useProAuth.ts),消费者通过 useProAuthSelector
 * 精确订阅。心跳每 60s 刷一次 store,balance 等字段未变化的消费者(比如 chat
 * 输入框)不会被无意义 re-render。
 */
export function ProAuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "login" | "ready">(
    isPro() ? "checking" : "ready"
  );

  useEffect(() => {
    if (!isPro()) return;
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(data => {
        if (data.success && data.data) {
          setProAuthStore({ user: data.data });
          setState("ready");
        } else {
          setState("login");
        }
      })
      .catch(() => setState("login"));
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "DELETE" });
    setProAuthStore({ user: null });
    setState("login");
  }, []);

  // 把当前 logout 函数注入 store,让消费者能拿到。logout 引用稳定(useCallback
  // 无依赖),整个进程只 set 一次,不会引起 selector 抖动。
  useEffect(() => {
    setProAuthStore({ logout });
  }, [logout]);

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
        if (cancelled) return;
        if (data && data.valid === false) {
          setProAuthStore({ user: null });
          setState("login");
          return;
        }
        // Heartbeat ships the fresh user payload so balance / membership /
        // custom-provider flags update without a manual reload.
        if (data && data.user) {
          setProAuthStore({ user: data.user });
        }
        // Server just refreshed chat/image providers from lumos-web. Tell
        // the chat surface to re-read its provider list so admin edits
        // show up without a relogin.
        if (data && data.synced) {
          window.dispatchEvent(new CustomEvent("provider-changed"));
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
              if (data.success && data.data) setProAuthStore({ user: data.data });
            })
            .catch(() => {});
          setState("ready");
        }}
      />
    );
  }

  return <>{children}</>;
}
