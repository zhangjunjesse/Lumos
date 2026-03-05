"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import QRCode from "qrcode";

interface QRBindingCardProps {
  sessionId: string;
  sessionTitle?: string;
  onBind?: () => void;
}

export function QRBindingCard({ sessionId, sessionTitle, onBind }: QRBindingCardProps) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [bindingId, setBindingId] = useState("");
  const [status, setStatus] = useState<"pending" | "active">("pending");

  useEffect(() => {
    const createBinding = async () => {
      try {
        const res = await fetch("/api/bridge/bindings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const data = await res.json();
        const qrDataUrl = await QRCode.toDataURL(data.qrUrl, { width: 200 });
        setQrDataUrl(qrDataUrl);
        setBindingId(data.bindToken);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    createBinding();
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || status === "active") return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/bridge/bindings?sessionId=${sessionId}`);
        const data = await res.json();
        const activeBinding = data.bindings?.find((b: any) => b.status === "active");
        if (activeBinding) {
          setStatus("active");
          onBind?.();
        }
      } catch (err) {
        console.error(err);
      }
    }, 2000);
    return () => clearInterval(poll);
  }, [sessionId, status, onBind]);

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <h3 className="text-sm font-medium">扫码绑定飞书群组</h3>
      <div className="flex justify-center">
        {loading ? (
          <div className="h-[200px] w-[200px] bg-muted animate-pulse rounded" />
        ) : status === "active" ? (
          <div className="flex h-[200px] w-[200px] items-center justify-center rounded bg-green-50 dark:bg-green-950">
            <p className="text-sm text-green-600 dark:text-green-400">✓ 绑定成功</p>
          </div>
        ) : (
          <img src={qrDataUrl} alt="QR Code" className="rounded" />
        )}
      </div>
      <p className="text-xs text-muted-foreground text-center">
        {status === "active" ? "已成功绑定飞书群组" : "使用飞书扫码创建群组并绑定此会话"}
      </p>
    </div>
  );
}
