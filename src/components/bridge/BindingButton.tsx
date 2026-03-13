"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useBinding } from "@/hooks/useBinding";
import { BindingStatusBadge } from "./BindingStatusBadge";
import { BindingStatusPopover } from "./BindingStatusPopover";
import { ShareLinkDialog } from "./ShareLinkDialog";
import { Toast } from "@/components/ui/toast";
import { openAuthUrl } from "@/lib/open-auth";

interface BindingButtonProps {
  sessionId: string;
}

interface FeishuAuthStatus {
  authenticated: boolean;
  reason?: "ok" | "missing" | "expired";
  user?: { name?: string; avatarUrl?: string; userId?: string } | null;
  expiresAt?: number | null;
  refreshExpiresAt?: number | null;
  remainingMs?: number | null;
  refreshRemainingMs?: number | null;
  willExpireSoon?: boolean;
}

export function BindingButton({ sessionId }: BindingButtonProps) {
  const { binding, stats, loading, updateBinding, deleteBinding, refetch } = useBinding(sessionId);
  const [configured, setConfigured] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [loginInFlight, setLoginInFlight] = useState(false);
  const [authStatus, setAuthStatus] = useState<FeishuAuthStatus | null>(null);
  const [shareLink, setShareLink] = useState("");
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const pendingCreateRef = useRef(false);
  const pendingEnableSyncRef = useRef<number | null>(null);
  const authLostNotifiedRef = useRef(false);
  const createBindingRef = useRef<() => void>(() => {});

  const fetchAuthStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/feishu/auth/status", { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json() as FeishuAuthStatus;
      setAuthStatus(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  const handleAuthSuccess = useCallback(() => {
    setLoginInFlight(false);
    authLostNotifiedRef.current = false;
    setAuthStatus((prev) => ({
      authenticated: true,
      reason: "ok",
      user: prev?.user ?? null,
      expiresAt: prev?.expiresAt ?? null,
      refreshExpiresAt: prev?.refreshExpiresAt ?? null,
      remainingMs: prev?.remainingMs ?? null,
      refreshRemainingMs: prev?.refreshRemainingMs ?? null,
      willExpireSoon: false,
    }));

    if (binding?.id && binding.status === "expired") {
      void (async () => {
        const result = await updateBinding(binding.id, { status: "active" });
        if (result.success) {
          await refetch();
          setToast({ type: "success", message: "飞书登录恢复，已自动恢复同步" });
        }
      })();
    }

    if (pendingEnableSyncRef.current) {
      const nextBindingId = pendingEnableSyncRef.current;
      pendingEnableSyncRef.current = null;
      void (async () => {
        const result = await updateBinding(nextBindingId, { status: "active" });
        if (result.success) {
          await refetch();
          setToast({ type: "success", message: "已恢复同步" });
        } else {
          setToast({ type: "error", message: result.error || "恢复同步失败" });
        }
      })();
    }

    if (pendingCreateRef.current) {
      pendingCreateRef.current = false;
      createBindingRef.current();
    }
  }, [binding?.id, binding?.status, refetch, updateBinding]);

  useEffect(() => {
    const checkConfig = async () => {
      try {
        const res = await fetch("/api/bridge/config");
        const data = await res.json();
        setConfigured(data.configured);
      } catch (err) {
        console.error(err);
      } finally {
        setConfigLoading(false);
      }
    };
    checkConfig();
  }, []);

  useEffect(() => {
    void fetchAuthStatus();
  }, [fetchAuthStatus]);

  useEffect(() => {
    const onAuthSuccess = (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (data?.type === "feishu-auth-success") {
        handleAuthSuccess();
      } else if (data?.type === "feishu-auth-failed") {
        setLoginInFlight(false);
        pendingCreateRef.current = false;
        pendingEnableSyncRef.current = null;
        setToast({ type: "error", message: "飞书授权失败，请重试" });
      }
    };
    window.addEventListener("message", onAuthSuccess);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== "lumos:feishu-auth-event" || !event.newValue) return;
      try {
        const data = JSON.parse(event.newValue) as { type?: string };
        if (data?.type === "feishu-auth-success") {
          handleAuthSuccess();
        } else if (data?.type === "feishu-auth-failed") {
          setLoginInFlight(false);
          pendingCreateRef.current = false;
          pendingEnableSyncRef.current = null;
          setToast({ type: "error", message: "飞书授权失败，请重试" });
        }
      } catch {
        // ignore invalid payload
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("message", onAuthSuccess);
      window.removeEventListener("storage", onStorage);
    };
  }, [handleAuthSuccess]);

  useEffect(() => {
    const shouldPoll = Boolean(binding) || loginInFlight;
    if (!shouldPoll) return;

    let cancelled = false;
    const checkAuthState = async () => {
      const latest = await fetchAuthStatus();
      if (!latest || cancelled) return;

      if (latest.authenticated) {
        authLostNotifiedRef.current = false;
        return;
      }

      if (!binding) return;
      if (binding.status !== "active" && binding.status !== "expired") return;

      if (!authLostNotifiedRef.current) {
        authLostNotifiedRef.current = true;
        setToast({
          type: "error",
          message:
            latest.reason === "expired"
              ? "飞书登录已过期，同步已暂停，请重新登录飞书"
              : "飞书当前未登录，同步已暂停，请重新登录飞书",
        });
      }

      if (binding.status === "active") {
        const result = await updateBinding(binding.id, { status: "expired" });
        if (result.success) {
          await refetch();
        }
      }
    };

    void checkAuthState();
    const timer = window.setInterval(() => {
      void checkAuthState();
    }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [binding, fetchAuthStatus, loginInFlight, refetch, updateBinding]);

  const openFeishuLogin = useCallback(async (retryAfterLogin: boolean) => {
    if (loginInFlight) return;
    setLoginInFlight(true);
    if (retryAfterLogin) pendingCreateRef.current = true;

    try {
      const res = await fetch("/api/feishu/auth/login");
      const data = await res.json();
      if (!data?.url) {
        setLoginInFlight(false);
        pendingCreateRef.current = false;
        pendingEnableSyncRef.current = null;
        setToast({ type: "error", message: "飞书登录入口获取失败，请稍后重试" });
        return;
      }

      await openAuthUrl(data.url);

      let count = 0;
      const timer = setInterval(async () => {
        count += 1;
        try {
          const status = await fetchAuthStatus();
          if (status?.authenticated) {
            clearInterval(timer);
            handleAuthSuccess();
          }
        } catch {
          // ignore transient errors
        }
        if (count >= 30) {
          clearInterval(timer);
          setLoginInFlight(false);
          pendingCreateRef.current = false;
          pendingEnableSyncRef.current = null;
          setToast({ type: "error", message: "飞书登录超时，请重试" });
        }
      }, 2000);
    } catch {
      setLoginInFlight(false);
      pendingCreateRef.current = false;
      pendingEnableSyncRef.current = null;
      setToast({ type: "error", message: "飞书登录失败，请稍后重试" });
    }
  }, [fetchAuthStatus, handleAuthSuccess, loginInFlight]);

  const handleCreate = useCallback(async () => {
    if (!configured) {
      setToast({ type: "error", message: "请先在设置中完成飞书配置" });
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/bridge/bindings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId }),
      });

      if (res.ok) {
        const data = await res.json();
        setShareLink(data.shareLink);
        setShowShareDialog(true);
        await refetch();
      } else {
        const errorData = await res.json();
        if (
          errorData?.action === "goto_feishu_login" ||
          errorData?.error === "FEISHU_AUTH_REQUIRED" ||
          errorData?.error === "FEISHU_AUTH_EXPIRED"
        ) {
          await openFeishuLogin(true);
        } else {
          setToast({ type: "error", message: errorData.message || errorData.error || "创建绑定失败" });
        }
      }
    } catch {
      setToast({ type: "error", message: "网络连接失败，请检查网络后重试" });
    } finally {
      setCreating(false);
    }
  }, [configured, openFeishuLogin, refetch, sessionId]);

  useEffect(() => {
    createBindingRef.current = () => handleCreate();
  }, [handleCreate]);

  const handleToggleSync = async (enabled: boolean) => {
    if (!binding) return;

    if (enabled && authStatus && !authStatus.authenticated) {
      pendingEnableSyncRef.current = binding.id;
      await openFeishuLogin(false);
      return;
    }

    const result = await updateBinding(binding.id, {
      status: enabled ? "active" : "inactive",
    });

    if (result.success) {
      setToast({
        type: "success",
        message: enabled ? "已恢复同步" : "已暂停同步",
      });
    } else {
      setToast({ type: "error", message: result.error || "操作失败" });
    }
  };

  const handleUnbind = async () => {
    if (!binding) return;

    const result = await deleteBinding(binding.id);

    if (result.success) {
      setToast({ type: "success", message: "已解绑" });
    } else {
      setToast({ type: "error", message: result.error || "解绑失败" });
    }
  };

  if (configLoading || loading) return null;

  const showBindButton = !binding;
  const shouldMarkExpired =
    Boolean(binding) &&
    Boolean(authStatus) &&
    authStatus?.authenticated === false &&
    binding?.status === "active";
  const displayBinding = binding && shouldMarkExpired
    ? { ...binding, status: "expired" as const }
    : binding;

  return (
    <>
      {showBindButton ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={handleCreate}
          disabled={creating}
          className="gap-1.5"
        >
          {creating ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
            </svg>
          )}
          <span className="text-xs">{configured ? "同步到飞书" : "配置飞书同步"}</span>
        </Button>
      ) : (
        <BindingStatusPopover
          binding={displayBinding!}
          stats={stats}
          onToggleSync={handleToggleSync}
          onUnbind={handleUnbind}
          onRelogin={async () => {
            pendingEnableSyncRef.current = binding?.id ?? null;
            await openFeishuLogin(false);
          }}
          reloginLoading={loginInFlight}
          authExpiresAt={authStatus?.expiresAt ?? null}
        >
          <BindingStatusBadge status={displayBinding!.status} />
        </BindingStatusPopover>
      )}

      <ShareLinkDialog
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
        shareLink={shareLink}
      />

      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
    </>
  );
}
