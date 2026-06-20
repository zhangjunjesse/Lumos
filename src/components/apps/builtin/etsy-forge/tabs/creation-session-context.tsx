'use client';

// 创作区会话单例:Provider 调一次 useCreationSessionState 并向下共享,
// 让 CreationDock 与 WarehouseTab 用同一份会话状态——切换/新建/删除互相同步,
// 且首次冷启动不会两个组件各建一个冗余会话。

import { createContext, useContext, type ReactNode } from 'react';
import { useCreationSessionState, type CreationSessionState } from './use-creation-session';

export type { CreationSessionMeta, CreationSessionState } from './use-creation-session';

const CreationSessionContext = createContext<CreationSessionState | null>(null);

export function CreationSessionProvider({ children }: { children: ReactNode }) {
  const value = useCreationSessionState();
  return <CreationSessionContext.Provider value={value}>{children}</CreationSessionContext.Provider>;
}

export function useCreationSession(): CreationSessionState {
  const ctx = useContext(CreationSessionContext);
  if (!ctx) throw new Error('useCreationSession 必须在 CreationSessionProvider 内使用');
  return ctx;
}
