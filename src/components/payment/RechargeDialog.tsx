"use client";

import { useMemo, useState } from "react";
import { CreditCard, ExternalLink, RefreshCw } from "lucide-react";
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

type PayType = "alipay" | "wxpay";

interface Props {
  trigger: React.ReactNode;
}

export function RechargeDialog({ trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("50");
  const [payType, setPayType] = useState<PayType>("alipay");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [payUrl, setPayUrl] = useState("");

  const amountNumber = useMemo(() => Number(amount), [amount]);
  const amountValid = Number.isFinite(amountNumber) && amountNumber >= 1 && amountNumber <= 100000;

  const resetTransient = () => {
    setError("");
    setMessage("");
    setPayUrl("");
  };

  const handlePay = async () => {
    resetTransient();
    if (!amountValid) {
      setError("请输入 1 到 100000 元之间的充值金额");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/payment/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountYuan: amountNumber, payType }),
      });
      const data = await res.json();
      if (data.success && data.data?.payUrl) {
        setPayUrl(data.data.payUrl);
        window.open(data.data.payUrl, "_blank", "noopener,noreferrer");
        setMessage("支付页面已打开。支付完成后返回这里刷新余额。");
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
    const before = getProAuthStore().user?.balance ?? 0;
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json();
      if (!data.success || !data.data) {
        setError(data.message || "刷新余额失败");
        return;
      }
      setProAuthStore({ user: data.data });
      const after = Number(data.data.balance ?? 0);
      setMessage(after > before ? "余额已更新" : "还没有检测到到账，请稍后再刷新。");
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
          <div className="grid grid-cols-4 gap-2">
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
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">充值金额</span>
            <div className="flex h-10 items-center rounded-md border border-border px-3 focus-within:border-primary/60">
              <span className="text-sm text-muted-foreground">¥</span>
              <input
                value={amount}
                onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, "")); resetTransient(); }}
                inputMode="decimal"
                className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none"
                placeholder="输入金额"
              />
            </div>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <PayTypeButton active={payType === "alipay"} onClick={() => setPayType("alipay")}>
              支付宝
            </PayTypeButton>
            <PayTypeButton active={payType === "wxpay"} onClick={() => setPayType("wxpay")}>
              微信支付
            </PayTypeButton>
          </div>

          {error && <p className="text-[13px] text-destructive">{error}</p>}
          {message && <p className="text-[13px] text-muted-foreground">{message}</p>}

          <button
            onClick={handlePay}
            disabled={loading || !amountValid}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            <CreditCard className="h-4 w-4" />
            {loading ? "创建订单中..." : `支付 ¥${amountValid ? amountNumber.toFixed(2) : "--"}`}
          </button>

          {payUrl && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => window.open(payUrl, "_blank", "noopener,noreferrer")}
                className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-border text-sm transition hover:bg-accent"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                打开支付页
              </button>
              <button
                type="button"
                onClick={refreshBalance}
                disabled={refreshing}
                className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-border text-sm transition hover:bg-accent disabled:opacity-50"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                刷新余额
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PayTypeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 rounded-md border text-sm transition-colors",
        active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
