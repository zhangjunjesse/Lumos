"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { SubmitButton } from "./LoginForm";

const inputCls =
  "h-10 w-full rounded-lg border border-neutral-200 bg-white/70 px-3.5 text-sm text-neutral-800 outline-none transition placeholder:text-neutral-300 focus:border-violet-300 focus:ring-2 focus:ring-violet-100";

interface Props {
  onSuccess: () => void;
}

export function RegisterForm({ onSuccess }: Props) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => () => { clearInterval(timerRef.current); }, []);

  const sendCode = useCallback(async () => {
    if (!email || countdown > 0) return;
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, purpose: "register" }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "发送失败"); return; }
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
  }, [email, countdown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) { setError("密码至少 6 位"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, password, nickname: nickname || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        onSuccess();
      } else {
        setError(data.message || "注册失败");
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
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="邮箱"
        className={inputCls}
        required
        autoComplete="email"
      />
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="验证码"
          className={inputCls}
          required
          maxLength={6}
          inputMode="numeric"
        />
        <button
          type="button"
          onClick={sendCode}
          disabled={countdown > 0 || !email}
          className="h-10 shrink-0 rounded-lg border border-neutral-200 bg-white/70 px-3 text-xs text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-40"
        >
          {countdown > 0 ? `${countdown}s` : "发送验证码"}
        </button>
      </div>
      <input
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        placeholder="设置密码（至少 6 位）"
        className={inputCls}
        required
        minLength={6}
        autoComplete="new-password"
      />
      <input
        type="text"
        value={nickname}
        onChange={e => setNickname(e.target.value)}
        placeholder="昵称（选填）"
        className={inputCls}
        autoComplete="name"
      />
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-500">{error}</p>
      )}
      <SubmitButton loading={submitting} text="注册" loadingText="注册中..." />
    </form>
  );
}
