"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CreditCard, RefreshCw } from "lucide-react";
import Image from "next/image";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";
import { getProAuthStore, setProAuthStore } from "@/hooks/useProAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const AMOUNT_PRESETS = [10, 50, 100, 200] as const;
type PaymentState = "idle" | "waiting" | "success" | "timeout";

interface Props {
  trigger: React.ReactNode;
}

export function RechargeDialog({ trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("50");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [payUrl, setPayUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [polling, setPolling] = useState(false);
  const [paymentState, setPaymentState] = useState<PaymentState>("idle");
  const amountInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollStartedAtRef = useRef(0);
  const balanceBeforePayRef = useRef(0);

  const amountNumber = useMemo(() => Number(amount), [amount]);
  const amountValid = Number.isFinite(amountNumber) && amountNumber >= 1 && amountNumber <= 100000;
  const presetSelected = AMOUNT_PRESETS.some((value) => Number(amount) === value);

  const resetTransient = () => {
    stopPolling();
    setError("");
    setMessage("");
    setPayUrl("");
    setQrDataUrl("");
    setPaymentState("idle");
  };

  const stopPolling = () => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setPolling(false);
  };

  const checkBalanceUpdated = async (before: number): Promise<boolean> => {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    const data = await res.json();
    if (!data.success || !data.data) {
      throw new Error(data.message || "刷新余额失败");
    }
    setProAuthStore({ user: data.data });
    const after = Number(data.data.balance ?? 0);
    return after > before;
  };

  const startBalancePolling = (before: number) => {
    stopPolling();
    pollStartedAtRef.current = Date.now();
    setPolling(true);

    pollTimerRef.current = window.setInterval(async () => {
      try {
        const arrived = await checkBalanceUpdated(before);
        if (arrived) {
          stopPolling();
          setPaymentState("success");
          setMessage("支付成功，余额已到账");
          return;
        }

        if (Date.now() - pollStartedAtRef.current > 10 * 60 * 1000) {
          stopPolling();
          setPaymentState("timeout");
          setMessage("暂未检测到到账，可稍后手动刷新余额。");
        }
      } catch {
        // Keep polling through transient network errors; manual refresh still reports failures.
      }
    }, 5000);
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  useEffect(() => {
    if (!payUrl) {
      setQrDataUrl("");
      return;
    }

    let cancelled = false;
    QRCode.toDataURL(payUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 224,
      color: {
        dark: "#111827",
        light: "#ffffff",
      },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError("二维码生成失败，请使用备用支付页");
      });

    return () => {
      cancelled = true;
    };
  }, [payUrl]);

  const handlePay = async () => {
    resetTransient();
    if (!amountValid) {
      setError("请输入 1 到 100000 元之间的充值金额");
      return;
    }

    setLoading(true);
    try {
      const before = getProAuthStore().user?.balance ?? 0;
      balanceBeforePayRef.current = before;
      const res = await fetch("/api/payment/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountYuan: amountNumber, payType: "alipay" }),
      });
      const data = await res.json();
      if (data.success && data.data?.payUrl) {
        setPayUrl(data.data.payUrl);
        setPaymentState("waiting");
        setMessage("请使用支付宝扫码支付。系统会自动检测到账。");
        startBalancePolling(before);
      } else {
        setError(data.message || data.error || "创建订单失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const refreshBalance = async () => {
    setRefreshing(true);
    setError("");
    setMessage("");
    try {
      const before = payUrl ? balanceBeforePayRef.current : getProAuthStore().user?.balance ?? 0;
      const arrived = await checkBalanceUpdated(before);
      if (arrived) {
        stopPolling();
        setPaymentState("success");
        setMessage("支付成功，余额已到账");
      } else {
        setMessage("还没有检测到到账，系统会继续自动检测。");
      }
    } catch {
      setError("刷新余额失败");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) resetTransient(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>充值余额</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-2">
            {AMOUNT_PRESETS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => { setAmount(String(value)); resetTransient(); }}
                className={cn(
                  "h-9 rounded-md border text-sm font-medium transition-colors",
                  Number(amount) === value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                ¥{value}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setAmount("");
                resetTransient();
                amountInputRef.current?.focus();
              }}
              className={cn(
                "h-9 rounded-md border text-xs font-medium transition-colors",
                !presetSelected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              其他金额
            </button>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">充值金额</span>
            <div className="flex h-10 items-center rounded-md border border-border px-3 focus-within:border-primary/60">
              <span className="text-sm text-muted-foreground">¥</span>
              <input
                ref={amountInputRef}
                value={amount}
                onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, "")); resetTransient(); }}
                inputMode="decimal"
                className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none"
                placeholder="输入金额"
              />
            </div>
          </label>

          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground">支付方式</span>
            <div className="flex h-9 items-center justify-center rounded-md border border-primary bg-primary/10 text-sm text-primary">
              支付宝
            </div>
          </div>

          {error && <p className="text-[13px] text-destructive">{error}</p>}
          {message && (
            <p className="text-[13px] text-muted-foreground">
              {message}
              {polling && paymentState === "waiting" ? "（自动检测中）" : ""}
            </p>
          )}

          <button
            onClick={handlePay}
            disabled={loading || !amountValid}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            <CreditCard className="h-4 w-4" />
            {loading ? "创建订单中..." : `支付 ¥${amountValid ? amountNumber.toFixed(2) : "--"}`}
          </button>

          {payUrl && (
            <div className="space-y-3">
              {paymentState === "success" ? (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-center text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="mx-auto mb-2 h-9 w-9" />
                  <div className="text-sm font-medium">支付成功</div>
                  <div className="mt-1 text-xs">余额已到账，可以继续使用 Lumos。</div>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-white p-3">
                  {qrDataUrl ? (
                    <Image
                      src={qrDataUrl}
                      alt="支付宝支付二维码"
                      width={224}
                      height={224}
                      unoptimized
                      className="mx-auto h-56 w-56"
                    />
                  ) : (
                    <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
                      正在生成二维码...
                    </div>
                  )}
                  {paymentState === "timeout" && (
                    <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-center text-xs text-amber-700">
                      暂未检测到到账，请确认支付结果后手动刷新。
                    </div>
                  )}
                </div>
              )}
              <div>
                <button
                  type="button"
                  onClick={refreshBalance}
                  disabled={refreshing || paymentState === "success"}
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-border text-sm transition hover:bg-accent disabled:opacity-50"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", (refreshing || polling) && paymentState !== "success" && "animate-spin")} />
                  {paymentState === "success" ? "已到账" : refreshing ? "刷新中" : "刷新余额"}
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
