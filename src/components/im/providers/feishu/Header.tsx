'use client';

import { BindingButton } from '@/components/bridge/BindingButton';

/**
 * 飞书在 chat header 上的入口：
 * BindingButton — 把当前 lumos session 绑到一个飞书 chat（chat ↔ session 1:1）。
 */
export function FeishuChatHeader({ sessionId }: { sessionId: string }) {
  return <BindingButton sessionId={sessionId} />;
}
