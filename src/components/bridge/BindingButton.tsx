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

export function BindingButton({ sessionId }: BindingButtonProps) {
  const { binding, stats, loading, updateBinding, deleteBinding, refetch } = useBinding(sessionId);
  const [configured, setConfigured] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [loginInFlight, setLoginInFlight] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const pendingCreateRef = useRef(false);
  const createBindingRef = useRef<() => void>(() => {});

  const handleAuthSuccess = useCallback(() => {
    setLoginInFlight(false);
    if (pendingCreateRef.current) {
      pendingCreateRef.current = false;
      createBindingRef.current();
    }
  }, []);

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
    const onAuthSuccess = (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (data?.type === "feishu-auth-success") {
        handleAuthSuccess();
      }
    };
    window.addEventListener("message", onAuthSuccess);
    return () => window.removeEventListener("message", onAuthSuccess);
  }, [handleAuthSuccess]);

  const openFeishuLogin = useCallback(async (retryAfterLogin: boolean) => {
    if (loginInFlight) return;
    setLoginInFlight(true);
    if (retryAfterLogin) pendingCreateRef.current = true;

    try {
      const res = await fetch("/api/feishu/auth/login");
      const data = await res.json();
      if (!data?.url) {
        setLoginInFlight(false);
        setToast({ type: "error", message: "飞书登录入口获取失败，请稍后重试" });
        return;
      }

      await openAuthUrl(data.url);

      let count = 0;
      const timer = setInterval(async () => {
        count += 1;
        try {
          const statusRes = await fetch("/api/feishu/auth/status");
          const status = await statusRes.json();
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
        }
      }, 2000);
    } catch (err) {
      setLoginInFlight(false);
      setToast({ type: "error", message: "飞书登录失败，请稍后重试" });
    }
  }, [handleAuthSuccess, loginInFlight]);

  const handleCreate = useCallback(async () => {
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
    } catch (err) {
      setToast({ type: "error", message: "网络连接失败，请检查网络后重试" });
    } finally {
      setCreating(false);
    }
  }, [openFeishuLogin, refetch]);

  useEffect(() => {
    createBindingRef.current = () => handleCreate();
  }, [handleCreate]);

  const handleToggleSync = async (enabled: boolean) => {
    if (!binding) return;

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

  if (configLoading || loading || !configured) return null;

  const showBindButton = !binding;

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
          <span className="text-xs">同步到飞书</span>
        </Button>
      ) : (
        <BindingStatusPopover
          binding={binding}
          stats={stats}
          onToggleSync={handleToggleSync}
          onUnbind={handleUnbind}
        >
          <BindingStatusBadge status={binding.status} onClick={handleCreate} />
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
