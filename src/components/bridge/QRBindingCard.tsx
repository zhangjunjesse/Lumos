"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { generateQrCodeDataUrl } from "@/lib/qr-code";

interface QRBindingCardProps {
  sessionId: string;
  sessionTitle?: string;
  onBind?: () => void;
}

export function QRBindingCard({ sessionId, onBind }: QRBindingCardProps) {
  const [bindingState, setBindingState] = useState({
    source: "",
    dataUrl: "",
    error: "",
  });
  const onBindRef = useRef(onBind);

  useEffect(() => {
    onBindRef.current = onBind;
  }, [onBind]);

  const loading = bindingState.source !== sessionId;
  const qrImageUrl = bindingState.source === sessionId ? bindingState.dataUrl : "";
  const error = bindingState.source === sessionId ? bindingState.error : "";

  useEffect(() => {
    let cancelled = false;

    const createBinding = async () => {
      try {
        const res = await fetch("/api/bridge/bindings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const data = await res.json();

        if (!res.ok) {
          if (!cancelled) {
            setBindingState({
              source: sessionId,
              dataUrl: "",
              error: data.message || data.error || "创建失败",
            });
          }
          return;
        }

        const dataUrl = await generateQrCodeDataUrl(data.shareLink, 200);
        if (!cancelled) {
          setBindingState({
            source: sessionId,
            dataUrl,
            error: "",
          });
          onBindRef.current?.();
        }
      } catch {
        if (!cancelled) {
          setBindingState({
            source: sessionId,
            dataUrl: "",
            error: "网络错误",
          });
        }
      }
    };

    createBinding();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

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
          <Image src={qrImageUrl} alt="QR Code" width={200} height={200} unoptimized className="rounded" />
        )}
      </div>
      <p className="text-xs text-muted-foreground text-center">
        {error ? "创建群组失败，请重试" : "使用飞书扫码加入群组，消息将实时同步"}
      </p>
    </div>
  );
}
