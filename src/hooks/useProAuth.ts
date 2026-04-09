"use client";

import { createContext, useContext } from "react";

export interface ProAuthUser {
  id: string;
  email: string;
  nickname: string;
  membership: "free" | "monthly" | "yearly";
  membership_expires_at: string | null;
  image_quota_monthly: number;
  role: "admin" | "user";
  balance: number;
  used_quota: number;
  // 向后兼容（sidebar-user-section / Header 等旧代码使用）
  username: string;
  display_name: string;
  quota: number;
  group: string;
}

export interface ProAuthContextValue {
  user: ProAuthUser | null;
  logout: () => void;
}

export const ProAuthContext = createContext<ProAuthContextValue>({
  user: null,
  logout: () => {},
});

export function useProAuth() {
  return useContext(ProAuthContext);
}
