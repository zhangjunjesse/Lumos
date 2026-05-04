"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading, CheckmarkCircle02Icon, AlertCircleIcon } from "@hugeicons/core-free-icons";

interface Props {
  /** 扫码绑定成功后通知父组件刷新配置 */
  onBound: () => void;
}

type Phase =
  | "idle"
  | "loading-qr"
  | "waiting"
  | "scanned"
  | "expired"
  | "confirmed"
  | "error";

interface QRSession {
  qrUrl: string;
  qrKey: string;
  qrDataUrl: string; // PNG data URL for <img>
}

const POLL_DELAY_MS = 1_000; // server already long-polls; we just chain

export function WechatBindCard({ onBound }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<QRSession | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const renderQR = useCallback(async (qrUrl: string, qrKey: string) => {
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 200 });
    setSession({ qrUrl, qrKey, qrDataUrl });
  }, []);

  const startQR = useCallback(async (): Promise<{ qrKey: string } | null> => {
    setPhase("loading-qr");
    setError(null);
    try {
      const res = await fetch("/api/im/wechat/setup/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "fetch QR failed");
      await renderQR(data.qrUrl, data.qrKey);
      setPhase("waiting");
      return { qrKey: data.qrKey };
    } catch (err) {
      const message = err instanceof Error ? err.message : "fetch QR failed";
      setError(message);
      setPhase("error");
      return null;
    }
  }, [renderQR]);

  const pollOnce = useCallback(async (qrKey: string): Promise<string> => {
    const url = new URL("/api/im/wechat/setup/poll", window.location.origin);
    url.searchParams.set("qrKey", qrKey);
    const res = await fetch(url.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "poll failed");
    return data.status;
  }, []);

  const runFlow = useCallback(async () => {
    cancelledRef.current = false;
    let session = await startQR();
    if (!session) return;

    let refreshes = 0;
    while (!cancelledRef.current) {
      let status: string;
      try {
        status = await pollOnce(session.qrKey);
      } catch (err) {
        setError(err instanceof Error ? err.message : "poll failed");
        setPhase("error");
        return;
      }

      if (cancelledRef.current) return;

      if (status === "confirmed") {
        setPhase("confirmed");
        onBound();
        return;
      }
      if (status === "scanned" || status === "scaned") {
        setPhase("scanned");
      } else if (status === "expired") {
        refreshes += 1;
        if (refreshes > 3) {
          setError("二维码已多次过期，请重试");
          setPhase("error");
          return;
        }
        const next = await startQR();
        if (!next) return;
        session = next;
        continue;
      } else {
        // wait / unknown — keep polling
        if (phase !== "waiting") setPhase("waiting");
      }

      await delay(POLL_DELAY_MS);
    }
  }, [startQR, pollOnce, onBound, phase]);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    setPhase("idle");
    setSession(null);
    setError(null);
  }, []);

  if (phase === "idle") {
    return (
      <div className="rounded-md border border-border/50 p-3">
        <p className="mb-2 text-xs text-muted-foreground">
          扫码绑定后会自动写入 Token；不需要填任何东西。
        </p>
        <Button size="sm" onClick={() => void runFlow()}>
          扫码绑定微信
        </Button>
      </div>
    );
  }

  if (phase === "confirmed") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-4 w-4" />
        绑定成功！可以保存配置后启用。
        <Button variant="ghost" size="sm" onClick={handleCancel} className="ml-auto">
          关闭
        </Button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
        <div className="flex items-center gap-2 text-sm text-destructive">
          <HugeiconsIcon icon={AlertCircleIcon} className="h-4 w-4" />
          {error || "未知错误"}
        </div>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => void runFlow()}>重试</Button>
          <Button variant="ghost" size="sm" onClick={handleCancel}>取消</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          {phase === "loading-qr" && (
            <>
              <HugeiconsIcon icon={Loading} className="h-4 w-4 animate-spin text-muted-foreground" />
              生成二维码…
            </>
          )}
          {phase === "waiting" && <span>请用微信扫描二维码</span>}
          {phase === "scanned" && <span className="text-blue-600">已扫码，请在手机确认</span>}
        </div>
        <Button variant="ghost" size="sm" onClick={handleCancel}>取消</Button>
      </div>
      {session?.qrDataUrl && (
        <div className="flex flex-col items-center gap-2">
          {/* QR PNG is a generated data URL (no remote optimization needed). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={session.qrDataUrl}
            alt="WeChat QR"
            width={200}
            height={200}
            className="rounded-md border border-border/50"
          />
          <a
            href={session.qrUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline break-all"
          >
            {session.qrUrl}
          </a>
        </div>
      )}
    </div>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
