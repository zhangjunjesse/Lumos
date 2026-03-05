"use client";

import { useState, useEffect } from "react";

interface QRBindingCardProps {
  sessionId: string;
  sessionTitle?: string;
  onBind?: () => void;
}

export function QRBindingCard({ sessionId, sessionTitle, onBind }: QRBindingCardProps) {
  const [qrImageUrl, setQrImageUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const createBinding = async () => {
      try {
        const res = await fetch("/api/bridge/bindings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const data = await res.json();

        if (!res.ok) {
          setError(data.message || data.error || "创建失败");
          return;
        }

        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(data.shareLink)}&size=200x200`;
        setQrImageUrl(qrImageUrl);
        onBind?.();
      } catch (err) {
        setError("网络错误");
      } finally {
        setLoading(false);
      }
    };
    createBinding();
  }, [sessionId, onBind]);

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <h3 className="text-sm font-medium">扫码加入飞书群组</h3>
      <div className="flex justify-center">
        {loading ? (
          <div className="h-[200px] w-[200px] bg-muted animate-pulse rounded" />
        ) : error ? (
          <div className="flex h-[200px] w-[200px] items-center justify-center rounded bg-red-50 dark:bg-red-950">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        ) : (
          <img src={qrImageUrl} alt="QR Code" className="rounded" />
        )}
      </div>
      <p className="text-xs text-muted-foreground text-center">
        {error ? "创建群组失败，请重试" : "使用飞书扫码加入群组，消息将实时同步"}
      </p>
    </div>
  );
}
