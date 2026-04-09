"use client";

import { useState } from "react";

interface Props {
  onLoggedIn?: () => void;
}

export function ProLoginPrompt({ onLoggedIn }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState<"user" | "pwd" | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/cloud-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.success) {
        onLoggedIn?.();
      } else {
        setError(data.message || "登录失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-background">
      {/* Drag region for Electron */}
      <div
        className="absolute inset-x-0 top-0 h-8 shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      {/* Subtle animated gradient background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-1/4 -top-1/4 h-[600px] w-[600px] rounded-full bg-primary/[0.04] blur-[100px] animate-[pulse_8s_ease-in-out_infinite]" />
        <div className="absolute -bottom-1/4 -right-1/4 h-[500px] w-[500px] rounded-full bg-primary/[0.03] blur-[100px] animate-[pulse_10s_ease-in-out_infinite_2s]" />
      </div>

      {/* Grid pattern overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 w-full max-w-[380px] px-6">
        {/* Brand */}
        <div className="mb-10 text-center">
          <div className="relative mx-auto mb-5 flex h-14 w-14 items-center justify-center">
            <div className="absolute inset-0 rounded-2xl bg-primary/10 ring-1 ring-primary/20" />
            <svg
              className="relative h-7 w-7 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Lumos</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            AI 智能工作台
          </p>
        </div>

        {/* Login card */}
        <div className="rounded-2xl border border-border/60 bg-card/80 p-6 shadow-lg shadow-black/[0.03] backdrop-blur-sm">
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Username */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">
                用户名
              </label>
              <div
                className={`group relative flex items-center rounded-xl border bg-background transition-all duration-200 ${
                  focused === "user"
                    ? "border-primary/50 ring-2 ring-primary/10"
                    : "border-border/80 hover:border-border"
                }`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground/50">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                  </svg>
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  onFocus={() => setFocused("user")}
                  onBlur={() => setFocused(null)}
                  placeholder="请输入用户名"
                  className="h-10 w-full bg-transparent pr-3 text-sm outline-none placeholder:text-muted-foreground/40"
                  required
                  autoComplete="username"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">
                密码
              </label>
              <div
                className={`group relative flex items-center rounded-xl border bg-background transition-all duration-200 ${
                  focused === "pwd"
                    ? "border-primary/50 ring-2 ring-primary/10"
                    : "border-border/80 hover:border-border"
                }`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground/50">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onFocus={() => setFocused("pwd")}
                  onBlur={() => setFocused(null)}
                  placeholder="请输入密码"
                  className="h-10 w-full bg-transparent pr-3 text-sm outline-none placeholder:text-muted-foreground/40"
                  required
                  autoComplete="current-password"
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="relative mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              {submitting ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : null}
              {submitting ? "登录中..." : "登录"}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs text-muted-foreground">
            还没有账号？{" "}
            <a
              href="http://lumos.miki.zj.cn/register"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:text-primary/80 transition-colors"
            >
              注册账号
            </a>
          </p>
        </div>

        {/* Version tag */}
        <div className="mt-8 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/40">
          <span>Powered by Lumos</span>
        </div>
      </div>
    </div>
  );
}
