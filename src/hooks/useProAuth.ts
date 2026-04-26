"use client";

import { useSyncExternalStore } from "react";
import type { CustomProviderFlags } from "@/lib/auth/custom-provider-capabilities";

export interface ProAuthUser {
  id: string;
  email: string;
  nickname: string;
  membership: "free" | "monthly" | "yearly";
  membership_expires_at: string | null;
  role: "admin" | "user";
  balance: number;
  used_quota: number;
  /** Pro-edition admin toggles per custom-provider category */
  allow_custom_providers: CustomProviderFlags;
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

/**
 * 模块级 store —— 取代之前的 React Context。
 *
 * 心跳每 60s 拉到的 user payload 之前直接 setState 喂进 Context.value,
 * Context 是新引用,所有 useProAuth() 消费者整体重渲染。在 chat 输入框这种
 * "值实际没变也不该被打扰"的场景里会破坏 input focus / 重置局部 state。
 *
 * 改成 store + listener 之后,消费者通过 useProAuthSelector(s => 字段) 订阅,
 * Object.is 不变就不触发 setState,React 跳过 re-render。selector 必须返回原始
 * 值或稳定引用 —— 不要在 selector 内部新建对象 / 数组,否则永远不等。
 *
 * useProAuth() 兼容接口保留,语义跟旧的 Context 用法一致(任何字段变都触发
 * 该消费者重渲染),只是不再走 Context 链路而已。
 */
const store: ProAuthContextValue = { user: null, logout: () => {} };
const listeners = new Set<() => void>();

export function setProAuthStore(next: Partial<ProAuthContextValue>): void {
  if ("user" in next) store.user = next.user ?? null;
  if (typeof next.logout === "function") store.logout = next.logout;
  // 单个 listener 抛错不能拖垮整条通知链(否则一个消费者写错 selector 会让
  // 心跳的 setProAuthStore 调用整体抛错,后续 listener 收不到通知)。每个
  // listener 独立 try/catch,失败的写到 console 便于排查。
  listeners.forEach((l) => {
    try {
      l();
    } catch (err) {
      console.error("[useProAuth] listener threw:", err);
    }
  });
}

export function getProAuthStore(): ProAuthContextValue {
  return store;
}

function subscribeProAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 按 selector 订阅 store 的某个切片。selector 返回值用 Object.is 比较,
 * 等于上一次就跳过 re-render。
 *
 * 底层用 React 18 的 useSyncExternalStore —— 这是官方推荐的"订阅外部 store"
 * API,正确处理并发渲染、tearing、订阅生命周期。我们提供 subscribe + getSnapshot,
 * React 自己负责 Object.is 比对、bail-out 优化。
 *
 * 用法约束:
 *   ✅ const flag = useProAuthSelector(s => s.user?.allow_custom_providers?.chat ?? null);
 *   ✅ const balance = useProAuthSelector(s => s.user?.balance ?? 0);
 *   ❌ useProAuthSelector(s => ({ a: s.user?.x, b: s.user?.y }))  // 每次新对象,Object.is 永远不等
 *
 * 要派生多个字段的话,组件内分别 useProAuthSelector 取出再组合。
 */
export function useProAuthSelector<T>(selector: (state: ProAuthContextValue) => T): T {
  return useSyncExternalStore(
    subscribeProAuth,
    () => selector(store),
    // server 端 snapshot:Lumos 是 client-only Electron + Next dev,理论不会
    // 走 SSR;给一个跟 client 同口径的实现兜底,即便走了也不崩。
    () => selector(store),
  );
}

/**
 * 兼容旧用法。返回整个 store 快照,user / logout 任一变化都会触发 re-render。
 * 新代码优先用 useProAuthSelector 精确订阅,避免无关字段抖动。
 *
 * 注:这里没用 useMemo 包装返回对象,所以每次 user 或 logout 变化时返回的
 * 顶层对象引用都会变 —— 这正是兼容旧 Context 行为的预期。要稳定就改用
 * useProAuthSelector。
 */
export function useProAuth(): ProAuthContextValue {
  const user = useProAuthSelector((s) => s.user);
  const logout = useProAuthSelector((s) => s.logout);
  return { user, logout };
}
