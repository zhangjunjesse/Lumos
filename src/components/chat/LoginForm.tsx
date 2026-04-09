"use client";

import { useState } from "react";

const inputCls =
  "h-10 w-full rounded-lg border border-neutral-200 bg-white/70 px-3.5 text-sm text-neutral-800 outline-none transition placeholder:text-neutral-300 focus:border-violet-300 focus:ring-2 focus:ring-violet-100";

interface Props {
  onSuccess: () => void;
}

export function LoginForm({ onSuccess }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.success) {
        onSuccess();
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
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="text"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="邮箱 / 昵称"
        className={inputCls}
        required
        autoComplete="username"
      />
      <input
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        placeholder="密码"
        className={inputCls}
        required
        autoComplete="current-password"
      />
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-500">{error}</p>
      )}
      <SubmitButton loading={submitting} text="登录" loadingText="登录中..." />
    </form>
  );
}

export function SubmitButton({ loading, text, loadingText }: { loading: boolean; text: string; loadingText: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-neutral-800 text-sm font-medium text-white transition hover:bg-neutral-700 active:scale-[0.98] disabled:opacity-50"
    >
      {loading && (
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {loading ? loadingText : text}
    </button>
  );
}
