"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const inputCls =
  "h-10 w-full rounded-lg border border-neutral-200 bg-white/70 px-3.5 text-sm text-neutral-800 outline-none transition placeholder:text-neutral-300 focus:border-violet-300 focus:ring-2 focus:ring-violet-100";

interface Props {
  onSuccess: () => void;
}

type Mode = "login" | "reset";

function getResponseMessage(data: { message?: string; error?: string }, fallback: string) {
  return data.message || data.error || fallback;
}

export function LoginForm({ onSuccess }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => () => { clearInterval(timerRef.current); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
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
        setError(getResponseMessage(data, "登录失败"));
      }
    } catch {
      setError("网络错误");
    } finally {
      setSubmitting(false);
    }
  };

  const sendResetCode = useCallback(async () => {
    if (!resetEmail || countdown > 0) return;
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/auth/password/reset/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail }),
      });
      const data = await res.json();
      if (!data.success) { setError(getResponseMessage(data, "发送失败")); return; }
      setNotice("如果该邮箱已注册，验证码会发送到邮箱。");
      setCountdown(60);
      timerRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) { clearInterval(timerRef.current); return 0; }
          return prev - 1;
        });
      }, 1000);
    } catch {
      setError("网络错误");
    }
  }, [resetEmail, countdown]);

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    if (resetPassword !== resetConfirmPassword) { setError("两次密码不一致"); return; }
    if (resetPassword.length < 6) { setError("密码至少 6 位"); return; }
    if (!resetCode) { setError("请输入验证码"); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail, code: resetCode, password: resetPassword }),
      });
      const data = await res.json();
      if (data.success) {
        setEmail(resetEmail);
        setPassword("");
        setResetCode("");
        setResetPassword("");
        setResetConfirmPassword("");
        setMode("login");
        setNotice("密码已重置，请使用新密码登录。");
      } else {
        setError(getResponseMessage(data, "重置密码失败"));
      }
    } catch {
      setError("网络错误");
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === "reset") {
    return (
      <form onSubmit={handleResetSubmit} className="space-y-3">
        <input
          type="email"
          value={resetEmail}
          onChange={e => setResetEmail(e.target.value)}
          placeholder="注册邮箱"
          className={inputCls}
          required
          autoComplete="email"
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={resetCode}
            onChange={e => setResetCode(e.target.value)}
            placeholder="验证码"
            className={inputCls}
            required
            maxLength={6}
            inputMode="numeric"
          />
          <button
            type="button"
            onClick={sendResetCode}
            disabled={countdown > 0 || !resetEmail}
            className="h-10 shrink-0 rounded-lg border border-neutral-200 bg-white/70 px-3 text-xs text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-40"
          >
            {countdown > 0 ? `${countdown}s` : "发送验证码"}
          </button>
        </div>
        <input
          type="password"
          value={resetPassword}
          onChange={e => setResetPassword(e.target.value)}
          placeholder="新密码（至少 6 位）"
          className={inputCls}
          required
          minLength={6}
          autoComplete="new-password"
        />
        <input
          type="password"
          value={resetConfirmPassword}
          onChange={e => setResetConfirmPassword(e.target.value)}
          placeholder="确认新密码"
          className={inputCls}
          required
          minLength={6}
          autoComplete="new-password"
        />
        {notice && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-600">{notice}</p>
        )}
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-500">{error}</p>
        )}
        <SubmitButton loading={submitting} text="重置密码" loadingText="重置中..." />
        <button
          type="button"
          onClick={() => { setMode("login"); setError(""); setNotice(""); }}
          className="h-9 w-full text-sm text-neutral-500 transition hover:text-neutral-800"
        >
          返回登录
        </button>
      </form>
    );
  }

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
      <div className="flex flex-col gap-1.5">
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="密码"
          className={inputCls}
          required
          autoComplete="current-password"
        />
        <button
          type="button"
          onClick={() => { setMode("reset"); setError(""); setNotice(""); setResetEmail(email); }}
          className="self-end text-xs text-neutral-400 transition hover:text-neutral-700"
        >
          忘记密码？
        </button>
      </div>
      {notice && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-600">{notice}</p>
      )}
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
