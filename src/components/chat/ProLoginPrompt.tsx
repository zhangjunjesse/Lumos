"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";

interface Props {
  onLoggedIn?: () => void;
}

type Tab = "login" | "register";

export function ProLoginPrompt({ onLoggedIn }: Props) {
  const [tab, setTab] = useState<Tab>("login");

  return (
    <div className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-neutral-100">
      {/* Electron drag region */}
      <div
        className="absolute inset-x-0 top-0 z-50 h-8"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      {/* Soft ambient blobs */}
      <div className="absolute -left-32 -top-32 h-[500px] w-[500px] rounded-full bg-violet-200/40 blur-[120px]" />
      <div className="absolute -bottom-32 -right-32 h-[400px] w-[400px] rounded-full bg-sky-200/40 blur-[120px]" />

      {/* Frosted card */}
      <div className="relative z-10 w-[360px] rounded-2xl border border-white/60 bg-white/50 p-8 shadow-lg shadow-black/[0.04] backdrop-blur-xl">
        {/* Brand */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 shadow-sm">
            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-neutral-800">Lumos</h1>
          <p className="mt-0.5 text-[13px] text-neutral-400">AI 智能工作台</p>
        </div>

        {/* Tab switcher */}
        <div className="mb-5 flex rounded-lg bg-neutral-100/80 p-0.5">
          <TabButton active={tab === "login"} onClick={() => setTab("login")}>登录</TabButton>
          <TabButton active={tab === "register"} onClick={() => setTab("register")}>注册</TabButton>
        </div>

        {/* Forms */}
        {tab === "login"
          ? <LoginForm onSuccess={() => onLoggedIn?.()} />
          : <RegisterForm onSuccess={() => onLoggedIn?.()} />
        }
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md py-1.5 text-sm font-medium transition",
        active
          ? "bg-white text-neutral-800 shadow-sm"
          : "text-neutral-400 hover:text-neutral-600"
      )}
    >
      {children}
    </button>
  );
}
