"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const PLANS = [
  { id: "monthly_basic", name: "基础月卡", price: 99, desc: "¥50 对话额度 + 30 张图片/月", tag: "" },
  { id: "monthly_pro", name: "专业月卡", price: 199, desc: "¥120 对话额度 + 80 张图片/月", tag: "推荐" },
  { id: "topup_50", name: "额度充值", price: 50, desc: "¥25 对话额度", tag: "" },
  { id: "image_pack", name: "图片加油包", price: 19.9, desc: "50 张图片", tag: "" },
];

type PayType = "alipay" | "wxpay";

interface Props {
  trigger: React.ReactNode;
}

export function RechargeDialog({ trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(PLANS[0].id);
  const [payType, setPayType] = useState<PayType>("alipay");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handlePay = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/payment/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: selectedPlan, payType }),
      });
      const data = await res.json();
      if (data.success && data.data?.payUrl) {
        window.open(data.data.payUrl, "_blank");
        setOpen(false);
      } else {
        setError(data.message || "创建订单失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const plan = PLANS.find(p => p.id === selectedPlan)!;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>充值</DialogTitle>
        </DialogHeader>

        {/* Plan selection */}
        <div className="grid grid-cols-2 gap-2">
          {PLANS.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedPlan(p.id)}
              className={cn(
                "relative rounded-lg border p-3 text-left transition",
                selectedPlan === p.id
                  ? "border-violet-400 bg-violet-50"
                  : "border-border hover:border-violet-200"
              )}
            >
              {p.tag && (
                <span className="absolute -top-2 right-2 rounded-full bg-violet-500 px-1.5 py-0.5 text-[10px] text-white">
                  {p.tag}
                </span>
              )}
              <p className="text-sm font-medium">{p.name}</p>
              <p className="mt-0.5 text-lg font-semibold text-violet-600">¥{p.price}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{p.desc}</p>
            </button>
          ))}
        </div>

        {/* Pay type */}
        <div className="flex gap-2">
          <PayTypeButton active={payType === "alipay"} onClick={() => setPayType("alipay")}>
            支付宝
          </PayTypeButton>
          <PayTypeButton active={payType === "wxpay"} onClick={() => setPayType("wxpay")}>
            微信支付
          </PayTypeButton>
        </div>

        {error && (
          <p className="text-[13px] text-red-500">{error}</p>
        )}

        {/* Pay button */}
        <button
          onClick={handlePay}
          disabled={loading}
          className="flex h-10 w-full items-center justify-center rounded-lg bg-violet-600 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
        >
          {loading ? "创建订单中..." : `支付 ¥${plan.price}`}
        </button>
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
        "flex-1 rounded-lg border py-2 text-sm transition",
        active ? "border-violet-400 bg-violet-50 text-violet-700" : "border-border text-muted-foreground hover:border-violet-200"
      )}
    >
      {children}
    </button>
  );
}
