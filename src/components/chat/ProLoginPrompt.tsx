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
    <div className="relative flex h-full w-full overflow-hidden bg-zinc-950">
      {/* Electron drag region */}
      <div
        className="absolute inset-x-0 top-0 z-50 h-8"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      {/* ── Left panel: brand + decoration ── */}
      <div className="relative hidden w-[45%] flex-col justify-between overflow-hidden p-10 lg:flex">
        {/* Gradient mesh background */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.15),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(99,102,241,0.3),transparent_60%)]" />

        {/* Decorative circles */}
        <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/[0.07] blur-sm" />
        <div className="absolute -bottom-16 -left-16 h-56 w-56 rounded-full bg-white/[0.05] blur-sm" />
        <div className="absolute right-12 top-1/3 h-2 w-2 rounded-full bg-white/40" />
        <div className="absolute left-1/4 top-1/2 h-1.5 w-1.5 rounded-full bg-white/30" />
        <div className="absolute bottom-1/3 right-1/3 h-1 w-1 rounded-full bg-white/50" />

        {/* Top: logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm">
            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
            </svg>
          </div>
          <span className="text-lg font-semibold text-white">Lumos</span>
        </div>

        {/* Center: tagline */}
        <div className="relative z-10 -mt-12">
          <h2 className="text-3xl font-bold leading-tight text-white">
            Your AI-Powered<br />Workspace
          </h2>
          <p className="mt-4 max-w-[280px] text-sm leading-relaxed text-white/60">
            Multi-model conversations, workflow automation,
            deep search, and knowledge management — all in one place.
          </p>
        </div>

        {/* Bottom: decoration dots */}
        <div className="relative z-10 flex gap-1.5">
          <div className="h-1.5 w-8 rounded-full bg-white/40" />
          <div className="h-1.5 w-1.5 rounded-full bg-white/20" />
          <div className="h-1.5 w-1.5 rounded-full bg-white/20" />
        </div>
      </div>

      {/* ── Right panel: login form ── */}
      <div className="relative flex flex-1 flex-col items-center justify-center bg-background px-6">
        {/* Subtle top-left glow on the right panel */}
        <div className="pointer-events-none absolute -left-32 -top-32 h-64 w-64 rounded-full bg-indigo-500/[0.06] blur-[80px] lg:bg-indigo-500/[0.04]" />

        <div className="w-full max-w-[340px]">
          {/* Mobile-only brand (hidden on lg) */}
          <div className="mb-8 text-center lg:hidden">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10">
              <svg className="h-6 w-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold">Lumos</h1>
          </div>

          {/* Heading */}
          <div className="mb-6">
            <h1 className="text-xl font-semibold tracking-tight">
              Welcome back
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in to your Lumos account
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium">
                用户名
              </label>
              <div
                className={`flex items-center rounded-lg border transition-all duration-150 ${
                  focused === "user"
                    ? "border-indigo-500/60 shadow-[0_0_0_3px_rgba(99,102,241,0.1)]"
                    : "border-border hover:border-border/80"
                }`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground/40">
                  <svg className="h-[15px] w-[15px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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

            <div className="space-y-1.5">
              <label className="text-[13px] font-medium">
                密码
              </label>
              <div
                className={`flex items-center rounded-lg border transition-all duration-150 ${
                  focused === "pwd"
                    ? "border-indigo-500/60 shadow-[0_0_0_3px_rgba(99,102,241,0.1)]"
                    : "border-border hover:border-border/80"
                }`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground/40">
                  <svg className="h-[15px] w-[15px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 text-[13px] font-medium text-white shadow-sm transition-all hover:bg-indigo-500 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              {submitting && (
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {submitting ? "登录中..." : "登录"}
            </button>
          </form>

          {/* Divider */}
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground/50">OR</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Register link */}
          <a
            href="http://lumos.miki.zj.cn/register"
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-10 w-full items-center justify-center rounded-lg border border-border text-[13px] font-medium text-foreground transition-colors hover:bg-accent"
          >
            注册新账号
          </a>

          {/* Footer */}
          <p className="mt-8 text-center text-[11px] text-muted-foreground/40">
            Powered by Lumos &middot; AI Workspace
          </p>
        </div>
      </div>
    </div>
  );
}
