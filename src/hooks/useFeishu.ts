import { createContext, useContext } from "react";

// 飞书用户信息
export interface FeishuUser {
  name: string;
  avatarUrl?: string;
  userId?: string;
}

// 飞书认证状态
export interface FeishuAuthState {
  authenticated: boolean;
  user: FeishuUser | null;
  loading: boolean;
}

// 飞书 Context 值
export interface FeishuContextValue {
  auth: FeishuAuthState;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

export const FeishuContext = createContext<FeishuContextValue | null>(null);

export function useFeishu(): FeishuContextValue {
  const ctx = useContext(FeishuContext);
  if (!ctx) throw new Error("useFeishu must be used within a FeishuProvider");
  return ctx;
}
