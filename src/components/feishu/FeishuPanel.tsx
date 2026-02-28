"use client";

import { useState, useCallback, useEffect } from "react";
import { FeishuAuth } from "./FeishuAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { FeishuContext } from "@/hooks/useFeishu";
import type { FeishuAuthState, FeishuContextValue } from "@/hooks/useFeishu";

export function FeishuPanel() {
  const { t } = useTranslation();
  const [auth, setAuth] = useState<FeishuAuthState>({
    authenticated: false,
    user: null,
    loading: true,
  });

  const refreshAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/feishu/auth/status");
      const data = await res.json();
      setAuth({
        authenticated: !!data.authenticated,
        user: data.user ?? null,
        loading: false,
      });
    } catch {
      setAuth({ authenticated: false, user: null, loading: false });
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const login = useCallback(async () => {
    try {
      const res = await fetch("/api/feishu/auth/login");
      const data = await res.json();
      if (data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
        // 轮询等待授权完成
        let count = 0;
        const timer = setInterval(async () => {
          count++;
          await refreshAuth();
          if (count >= 60) clearInterval(timer);
        }, 3000);
        setTimeout(() => refreshAuth(), 5000);
      }
    } catch (err) {
      console.error("Feishu login failed:", err);
    }
  }, [refreshAuth]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/feishu/auth/logout", { method: "POST" });
      setAuth({ authenticated: false, user: null, loading: false });
    } catch (err) {
      console.error("Feishu logout failed:", err);
    }
  }, []);

  const ctxValue: FeishuContextValue = { auth, login, logout, refreshAuth };

  return (
    <FeishuContext.Provider value={ctxValue}>
      <div className="h-full overflow-auto">
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-lg font-semibold">{t('feishu.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          {t('feishu.description')}
        </p>
        <FeishuAuth />
      </div>
    </FeishuContext.Provider>
  );
}
