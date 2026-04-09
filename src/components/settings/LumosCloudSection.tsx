"use client";

import { cn } from "@/lib/utils";
import { useProAuth } from "@/hooks/useProAuth";
import { RechargeDialog } from "@/components/payment/RechargeDialog";

const MEMBERSHIP_LABELS: Record<string, string> = {
  free: "免费版",
  monthly: "月卡会员",
  yearly: "年卡会员",
};

export function LumosCloudSection() {
  const { user, logout } = useProAuth();

  if (!user) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Lumos Cloud</h2>
          <p className="text-sm text-muted-foreground mt-1">
            登录 Lumos Cloud 即可使用内置 AI 模型
          </p>
        </div>
        <p className="text-sm text-muted-foreground">未登录</p>
      </div>
    );
  }

  const displayName = user.nickname || user.email;
  const balanceYuan = (user.balance / 500000).toFixed(2);
  const usedYuan = (user.used_quota / 500000).toFixed(2);
  const level = MEMBERSHIP_LABELS[user.membership] || "免费版";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Lumos Cloud</h2>
        <p className="text-sm text-muted-foreground mt-1">
          登录 Lumos Cloud 即可使用内置 AI 模型，无需自行配置 API Key
        </p>
      </div>

      <div className="rounded-lg border border-border p-6 space-y-4 max-w-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-medium text-sm">{displayName}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="text-xs text-muted-foreground hover:text-foreground transition"
          >
            退出登录
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className={cn("rounded-md border border-border p-3")}>
            <p className="text-xs text-muted-foreground">会员</p>
            <p className="text-sm font-semibold mt-0.5">{level}</p>
          </div>
          <div className={cn("rounded-md border border-border p-3")}>
            <p className="text-xs text-muted-foreground">余额</p>
            <p className="text-lg font-semibold mt-0.5">¥{balanceYuan}</p>
          </div>
          <div className={cn("rounded-md border border-border p-3")}>
            <p className="text-xs text-muted-foreground">已使用</p>
            <p className="text-lg font-semibold mt-0.5">¥{usedYuan}</p>
          </div>
        </div>

        {user.image_quota_monthly > 0 && (
          <div className="text-xs text-muted-foreground">
            本月图片配额: {user.image_quota_monthly} 张
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          已连接 Lumos Cloud 服务
        </div>

        <RechargeDialog
          trigger={
            <button className="w-full py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition">
              充值
            </button>
          }
        />
      </div>
    </div>
  );
}
