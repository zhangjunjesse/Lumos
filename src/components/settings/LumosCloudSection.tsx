"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useProAuth } from "@/hooks/useProAuth";
import { RechargeDialog } from "@/components/payment/RechargeDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

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

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          已连接 Lumos Cloud 服务
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ChangePasswordDialog
            trigger={
              <button className="py-2 rounded-md border border-border text-sm font-medium hover:bg-muted transition">
                修改密码
              </button>
            }
          />
          <RechargeDialog
            trigger={
              <button className="py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition">
                充值
              </button>
            }
          />
        </div>
      </div>
    </div>
  );
}

function ChangePasswordDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const resetState = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSubmitting(false);
    setError("");
    setSuccess("");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) resetState();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (newPassword !== confirmPassword) { setError("两次密码不一致"); return; }
    if (newPassword.length < 6) { setError("密码至少 6 位"); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/password/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setSuccess("密码已修改，当前设备保持登录。");
      } else {
        setError(data.message || data.error || "修改密码失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>修改密码</DialogTitle>
          <DialogDescription>
            修改 Lumos Cloud 登录密码。当前设备会保持登录，其它旧会话会失效。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            placeholder="当前密码"
            autoComplete="current-password"
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            required
          />
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="新密码（至少 6 位）"
            autoComplete="new-password"
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            required
            minLength={6}
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="确认新密码"
            autoComplete="new-password"
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            required
            minLength={6}
          />
          {success && <p className="text-sm text-green-600">{success}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "保存中..." : "保存"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
