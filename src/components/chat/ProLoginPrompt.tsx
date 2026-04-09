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
    <div className="relative flex h-screen w-full items-center justify-center overflow-hidden">
      {/* Electron drag region */}
      <div
        className="absolute inset-x-0 top-0 z-50 h-8"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.12),transparent_60%)]" />

      {/* Full-screen frosted overlay */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />

      {/* Centered card */}
      <div className="relative z-10 w-[360px] rounded-2xl border border-white/10 bg-white/[0.08] p-8 shadow-2xl shadow-black/20 backdrop-blur-xl">
        {/* Brand */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white/10">
            <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white">Lumos</h1>
          <p className="mt-1 text-sm text-white/50">AI 智能工作台</p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="用户名"
            className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.06] px-3.5 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-white/25 focus:bg-white/[0.08]"
            required
            autoComplete="username"
          />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="密码"
            className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.06] px-3.5 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-white/25 focus:bg-white/[0.08]"
            required
            autoComplete="current-password"
          />

          {error && (
            <p className="rounded-lg bg-red-500/15 px-3 py-2 text-[13px] text-red-300">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-white font-medium text-indigo-700 text-sm transition hover:bg-white/90 active:scale-[0.98] disabled:opacity-50"
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

        {/* Register */}
        <p className="mt-6 text-center text-xs text-white/35">
          还没有账号？{" "}
          <a
            href="http://lumos.miki.zj.cn/register"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/60 hover:text-white/80 transition-colors"
          >
            注册
          </a>
        </p>
      </div>
    </div>
  );
}
